import { describe, expect, it } from "@effect/vitest";
import {
	type HidDeviceInfo,
	HidTransport,
	QuakeDevice,
	QuakeHidCloseFailed,
	QuakeHidDiscoveryFailed,
	QuakeHidOpenFailed,
} from "@open-quake/device";
import {
	FAKE_QUAKE_DEVICE,
	makeFakeHidTransport,
} from "@open-quake/device/fake";
import { Effect, Exit, Layer, Queue, Scope, TestClock } from "effect";
import { vi } from "vitest";
import type { QuakeEvent } from "../preload/quake";
import { DEVICE_RECONNECT_MS, startDeviceBus } from "./deviceBus";
import { createEventForwarder } from "./eventForwarding";
import { report } from "./test/hid";

const makeHarness = Effect.gen(function* () {
	const scope = yield* Scope.make();
	yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
	const bus = yield* Scope.extend(startDeviceBus(), scope);
	const queue = yield* Queue.unbounded<QuakeEvent>();
	const received: QuakeEvent[] = [];
	bus.on((event) => {
		received.push(event);
		Queue.unsafeOffer(queue, event);
	});
	return {
		bus,
		next: Queue.take(queue),
		received,
		close: Scope.close(scope, Exit.void),
	};
});

const connected = { source: "hid", kind: "status", state: "connected" };
const missing = {
	source: "hid",
	kind: "status",
	state: "error",
	error: {
		_tag: "QuakeDeviceNotFound",
		code: "QUAKE.DEVICE.NOT_FOUND",
		category: "unavailable",
	},
};

const withTransport = (transport: Layer.Layer<HidTransport>) =>
	QuakeDevice.DefaultWithoutDependencies.pipe(Layer.provide(transport));

describe("HID desktop bus", () => {
	it.scoped("surfaces a native close failure during scope teardown", () =>
		Effect.gen(function* () {
			const fake = yield* makeFakeHidTransport();
			const error = new QuakeHidCloseFailed(new Error("private-close-cause"));
			const transport = Layer.succeed(HidTransport, {
				...fake.transport,
				open: (info) =>
					Effect.map(fake.transport.open(info), (handle) => ({
						...handle,
						close: () =>
							handle.close().pipe(Effect.zipRight(Effect.fail(error))),
					})),
			});
			yield* Effect.gen(function* () {
				const harness = yield* makeHarness;
				expect(yield* harness.next).toEqual(connected);
				yield* harness.close;
				expect(yield* harness.next).toEqual({
					source: "hid",
					kind: "status",
					state: "error",
					error: {
						_tag: "QuakeHidCloseFailed",
						code: "QUAKE.HID.CLOSE_FAILED",
						category: "dependency",
					},
				});
				expect(yield* fake.closes).toBe(1);
				expect(JSON.stringify(harness.received)).not.toContain(
					"private-close-cause",
				);
			}).pipe(Effect.provide(withTransport(transport)));
		}),
	);
	it.scoped(
		"selects Raw HID among all four collections and forwards real input to both windows",
		() =>
			Effect.gen(function* () {
				const devices: HidDeviceInfo[] = [
					{ ...FAKE_QUAKE_DEVICE, path: "system", usagePage: 1, usage: 0x80 },
					{ ...FAKE_QUAKE_DEVICE, path: "consumer", usagePage: 0xc, usage: 1 },
					{ ...FAKE_QUAKE_DEVICE, path: "keyboard", usagePage: 1, usage: 6 },
					FAKE_QUAKE_DEVICE,
				];
				const fake = yield* makeFakeHidTransport(devices);
				const opened: HidDeviceInfo[] = [];
				const layer = Layer.succeed(HidTransport, {
					...fake.transport,
					open: (info) => {
						opened.push(info);
						return fake.transport.open(info);
					},
				});
				yield* Effect.gen(function* () {
					const harness = yield* makeHarness;
					expect(yield* harness.next).toEqual(connected);
					const panel = {
						isDestroyed: () => false,
						webContents: { send: vi.fn() },
					};
					const management = {
						isDestroyed: () => false,
						webContents: { send: vi.fn() },
					};
					harness.bus.on(createEventForwarder(() => [panel, management]));
					for (const bytes of [
						report(3, 1, [1]),
						report(3, 1, [0]),
						report(3, 2, [1]),
						report(3, 2, [0]),
						report(0xa3, 26, [1, 2, 0x34, 1, 0x78, 5]),
						report(0x55, 0xef),
					])
						yield* fake.emit(bytes);
					const inputs = [
						{ source: "hid", kind: "rotate", direction: 1 },
						{ source: "hid", kind: "rotate", direction: -1 },
						{ source: "hid", kind: "press", state: 1 },
						{ source: "hid", kind: "press", state: 0 },
						{
							source: "hid",
							kind: "touch",
							points: [{ action: 2, x: 1400, y: 308 }],
						},
						{ source: "hid", kind: "keepalive", seq: 1 },
					];
					for (const input of inputs)
						expect(yield* harness.next).toEqual(input);
					expect(panel.webContents.send.mock.calls).toEqual(
						[connected, ...inputs].map((event) => ["quake:event", event]),
					);
					expect(management.webContents.send.mock.calls).toEqual(
						panel.webContents.send.mock.calls,
					);
					expect(opened).toEqual([FAKE_QUAKE_DEVICE]);
					yield* TestClock.adjust(15_000);
					expect(yield* fake.writes).toHaveLength(1);
					expect(
						harness.received.filter((event) => event.kind === "keepalive"),
					).toHaveLength(1);
					yield* harness.close;
					yield* harness.close;
					expect(yield* fake.closes).toBe(1);
					yield* TestClock.adjust(30_000);
					expect(yield* fake.writes).toHaveLength(1);
				}).pipe(Effect.provide(withTransport(layer)));
			}),
	);

	it.scoped(
		"survives absence, unplug, and reconnect, stopping writes and releasing each handle",
		() =>
			Effect.gen(function* () {
				const devices: HidDeviceInfo[] = [];
				const fake = yield* makeFakeHidTransport(devices);
				yield* Effect.gen(function* () {
					const harness = yield* makeHarness;
					expect(yield* harness.next).toEqual(missing);
					expect(yield* fake.opens).toBe(0);
					devices.push(FAKE_QUAKE_DEVICE);
					yield* TestClock.adjust(DEVICE_RECONNECT_MS);
					expect(yield* harness.next).toEqual(connected);
					yield* fake.emit(report(3, 1, [1]));
					expect(yield* harness.next).toMatchObject({
						kind: "rotate",
						source: "hid",
					});
					devices.length = 0;
					yield* fake.failRead(new Error("token=private-unplug-cause"));
					expect(yield* harness.next).toEqual({
						source: "hid",
						kind: "status",
						state: "disconnected",
						reason: "error",
					});
					expect(yield* harness.next).toEqual({
						source: "hid",
						kind: "status",
						state: "error",
						error: {
							_tag: "QuakeHidReadFailed",
							code: "QUAKE.HID.READ_FAILED",
							category: "dependency",
						},
					});
					expect(yield* fake.closes).toBe(1);
					yield* TestClock.adjust(15_000);
					expect(yield* fake.writes).toHaveLength(0);
					expect(harness.bus.currentStatus()).toEqual(missing);
					devices.push(FAKE_QUAKE_DEVICE);
					yield* TestClock.adjust(DEVICE_RECONNECT_MS);
					// Drain absence retries, then wait for the new connection.
					let event = yield* harness.next;
					while (event.kind === "status" && event.state === "error")
						event = yield* harness.next;
					expect(event).toEqual(connected);
					yield* fake.emit(report(3, 2, [1]));
					expect(yield* harness.next).toEqual({
						source: "hid",
						kind: "press",
						state: 1,
					});
					expect(yield* fake.opens).toBe(2);
					yield* harness.close;
					expect(yield* fake.closes).toBe(2);
					const count = harness.received.length;
					yield* TestClock.adjust(30_000);
					expect(harness.received).toHaveLength(count);
					expect(yield* fake.opens).toBe(2);
					expect(JSON.stringify(harness.received)).not.toContain(
						"private-unplug-cause",
					);
				}).pipe(Effect.provide(withTransport(fake.layer)));
			}),
	);

	for (const failure of ["discovery", "open"] as const) {
		it.scoped(
			`surfaces typed ${failure} errors without causes and retries`,
			() =>
				Effect.gen(function* () {
					const fake = yield* makeFakeHidTransport();
					const cause = new Error("token=secret-native-error");
					const error =
						failure === "discovery"
							? new QuakeHidDiscoveryFailed(cause)
							: new QuakeHidOpenFailed(cause);
					let broken = true;
					const transport = Layer.succeed(HidTransport, {
						...fake.transport,
						discover: () =>
							broken && error._tag === "QuakeHidDiscoveryFailed"
								? Effect.fail(error)
								: fake.transport.discover(),
						open: (info) =>
							broken && error._tag === "QuakeHidOpenFailed"
								? Effect.fail(error)
								: fake.transport.open(info),
					});
					yield* Effect.gen(function* () {
						const harness = yield* makeHarness;
						expect(yield* harness.next).toEqual({
							source: "hid",
							kind: "status",
							state: "error",
							error: {
								_tag: error._tag,
								code: error.code,
								category: error.category,
							},
						});
						expect(error.originalCause).toBe(cause);
						expect(JSON.stringify(harness.received)).not.toContain(
							"secret-native-error",
						);
						expect(JSON.stringify(harness.received)).not.toContain(
							"diagnosticCause",
						);
						broken = false;
						yield* TestClock.adjust(DEVICE_RECONNECT_MS);
						expect(yield* harness.next).toEqual(connected);
					}).pipe(Effect.provide(withTransport(transport)));
				}),
		);
	}

	for (const failure of ["end", "write", "close", "protocol"] as const) {
		it.scoped(`handles ${failure} termination and releases subscriptions`, () =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				const transport = Layer.succeed(HidTransport, {
					...fake.transport,
					open: (info) =>
						Effect.map(fake.transport.open(info), (handle) => ({
							...handle,
							close: () =>
								handle
									.close()
									.pipe(
										Effect.zipRight(
											failure === "close"
												? Effect.fail(
														new QuakeHidCloseFailed(new Error("private-close")),
													)
												: Effect.void,
										),
									),
						})),
				});
				yield* Effect.gen(function* () {
					const harness = yield* makeHarness;
					expect(yield* harness.next).toEqual(connected);
					const removed = vi.fn();
					const off = harness.bus.on(removed);
					off();
					if (failure === "write") {
						yield* fake.failWrite(new Error("private-write"));
						yield* TestClock.adjust(15_000);
					} else if (failure === "protocol") {
						const corrupt = report(3, 1, [1]);
						corrupt[5] = 0;
						yield* fake.emit(corrupt);
					} else yield* fake.end();
					expect(yield* harness.next).toMatchObject({
						kind: "status",
						state: "disconnected",
						reason: failure === "end" ? "transport-ended" : "error",
					});
					if (failure !== "end") {
						expect(yield* harness.next).toMatchObject({
							state: "error",
							error: {
								code:
									failure === "write"
										? "QUAKE.HID.WRITE_FAILED"
										: failure === "close"
											? "QUAKE.HID.CLOSE_FAILED"
											: "QUAKE.PROTOCOL.CHECKSUM_MISMATCH",
							},
						});
					}
					expect(yield* fake.closes).toBe(1);
					expect(removed).toHaveBeenCalledTimes(1); // Only the initial status replay.
					yield* harness.close;
					expect(yield* fake.closes).toBe(1);
					expect(JSON.stringify(harness.received)).not.toContain("private-");
				}).pipe(Effect.provide(withTransport(transport)));
			}),
		);
	}
});
