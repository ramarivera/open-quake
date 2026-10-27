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
import {
	Deferred,
	Effect,
	Exit,
	Fiber,
	Layer,
	Queue,
	Scope,
	TestClock,
} from "effect";
import { vi } from "vitest";
import { TOUCH_IDENTITY } from "../../../../packages/device/src/touch/touch-contracts";
import type { QuakeEvent } from "../preload/quake";
import {
	appendQuakeEvent,
	type QuakeEventState,
} from "../renderer/src/useQuakeEvents";
import { DEVICE_RECONNECT_MS, startDeviceBus } from "./deviceBus";
import { createEventForwarder } from "./eventForwarding";
import { makeTwoStrips, report } from "./test/hid";

const makeHarness = Effect.gen(function* () {
	const scope = yield* Scope.make();
	yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
	const bus = yield* Scope.extend(startDeviceBus(), scope);
	const queue = yield* Queue.unbounded<QuakeEvent>();
	const received: QuakeEvent[] = [];
	let rendererState: QuakeEventState = {
		events: [],
		eventsReceived: 0,
		rotations: 0,
		presses: 0,
		lastKeepAliveSeq: null,
		touchPoints: [],
	};
	bus.on((event) => {
		received.push(event);
		rendererState = appendQuakeEvent(rendererState, event);
		Queue.unsafeOffer(queue, event);
	});
	return {
		bus,
		next: Queue.take(queue),
		received,
		get rendererState() {
			return rendererState;
		},
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

it.scoped(
	"reconnects a secondary serial at its current HID path without crossing into another strip",
	() =>
		Effect.gen(function* () {
			const two = yield* makeTwoStrips;
			two.devices.push(two.b);
			yield* Effect.gen(function* () {
				const h = yield* makeHarness;
				yield* h.next;
				yield* TestClock.adjust(1000);
				const child = h.bus.device?.("B");
				expect(child?.currentStatus()?.state).toBe("connected");
				const events: QuakeEvent[] = [];
				child?.on((event) => events.push(event));
				two.b.path = "fake:B:re-enumerated";
				yield* two.second.failRead(new Error("re-enumerated"));
				yield* TestClock.adjust(1000);
				yield* child?.recover?.() ?? Effect.void;
				yield* TestClock.adjust(1);
				expect(yield* two.second.opens).toBe(2);
				expect(yield* two.first.opens).toBe(1);
				expect(h.bus.device?.("B")).toBe(child);
				expect(child?.currentStatus()?.state).toBe("connected");
				yield* two.second.emit(report(3, 1, [1]));
				yield* TestClock.adjust(1);
				expect(events.at(-1)).toMatchObject({ kind: "rotate", direction: 1 });
				two.b.path = "fake:B:again";
				yield* child?.recover?.(true) ?? Effect.void;
				yield* TestClock.adjust(1000);
				expect(yield* two.second.opens).toBe(3);
				expect(yield* two.first.opens).toBe(1);
			}).pipe(Effect.provide(withTransport(two.layer)));
		}),
);

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
					expect(harness.rendererState.presses).toBe(1);
					expect(harness.rendererState.lastKeepAliveSeq).toBe(1);
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
					yield* fake.emit(report(0x55, 0xef));
					expect(yield* harness.next).toEqual({
						source: "hid",
						kind: "keepalive",
						seq: 1,
					});
					expect(harness.rendererState.lastKeepAliveSeq).toBe(1);
					devices.length = 0;
					yield* fake.failRead(new Error("token=private-unplug-cause"));
					expect(yield* harness.next).toEqual({
						source: "hid",
						kind: "status",
						state: "disconnected",
						reason: "error",
					});
					expect(harness.rendererState.lastKeepAliveSeq).toBeNull();
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
					expect(harness.rendererState.lastKeepAliveSeq).toBeNull();
					devices.push(FAKE_QUAKE_DEVICE);
					yield* harness.bus.recover?.() ?? Effect.void;
					yield* TestClock.adjust(0);
					// Drain absence retries, then wait for the new connection.
					let event = yield* harness.next;
					while (event.kind === "status" && event.state === "error")
						event = yield* harness.next;
					expect(event).toEqual(connected);
					expect(harness.rendererState.lastKeepAliveSeq).toBeNull();
					yield* fake.emit(report(0x55, 0xef));
					expect(yield* harness.next).toEqual({
						source: "hid",
						kind: "keepalive",
						seq: 2,
					});
					expect(harness.rendererState.lastKeepAliveSeq).toBe(2);
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

	it.scoped(
		"backs off for five failed opens, then scans passively until explicit recovery",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				let attempts = 0;
				let broken = true;
				const layer = Layer.succeed(HidTransport, {
					...fake.transport,
					open: (info) => {
						attempts++;
						return broken
							? Effect.fail(new QuakeHidOpenFailed(new Error("private")))
							: fake.transport.open(info);
					},
				});
				yield* Effect.gen(function* () {
					const h = yield* makeHarness;
					yield* h.next;
					expect(attempts).toBe(1);
					for (const delay of [1000, 3000, 5000, 7000]) {
						yield* TestClock.adjust(delay - 1);
						const before = attempts;
						yield* TestClock.adjust(1);
						yield* h.next;
						expect(attempts).toBe(before + 1);
					}
					expect(attempts).toBe(5);
					yield* TestClock.adjust(60_000);
					expect(attempts).toBe(5);
					broken = false;
					yield* h.bus.recover?.() ?? Effect.void;
					yield* TestClock.adjust(0);
					expect(yield* h.next).toEqual(connected);
					expect(attempts).toBe(6);
				}).pipe(Effect.provide(withTransport(layer)));
			}),
	);
	it.scoped(
		"connects on the first passive scan when a device arrives during the final nine-second wait",
		() =>
			Effect.gen(function* () {
				const devices: HidDeviceInfo[] = [];
				const fake = yield* makeFakeHidTransport(devices);
				yield* Effect.gen(function* () {
					const harness = yield* makeHarness;
					expect(yield* harness.next).toEqual(missing);
					for (const delay of [1000, 3000, 5000, 7000]) {
						yield* TestClock.adjust(delay);
						expect(yield* harness.next).toEqual(missing);
					}
					// Five attempts have failed at t=16 s. Plug in halfway through
					// the final wait and leave the path unchanged afterward.
					expect(harness.received).toHaveLength(5);
					yield* TestClock.adjust(4500);
					devices.push(FAKE_QUAKE_DEVICE);
					yield* TestClock.adjust(4499);
					expect(yield* fake.opens).toBe(0);
					expect(harness.bus.currentStatus()).toEqual(missing);
					yield* TestClock.adjust(1);
					expect(harness.bus.currentStatus()).toEqual(connected);
					expect(yield* fake.opens).toBe(1);
					expect(yield* harness.next).toEqual(connected);
					yield* harness.close;
					expect(yield* fake.closes).toBe(1);
				}).pipe(Effect.provide(withTransport(fake.layer)));
			}),
	);
	it.scoped("resets reconnect delay after thirty stable seconds", () =>
		Effect.gen(function* () {
			const fake = yield* makeFakeHidTransport();
			yield* Effect.gen(function* () {
				const h = yield* makeHarness;
				yield* h.next;
				yield* fake.failRead(new Error("disconnect"));
				yield* h.next;
				yield* h.next;
				yield* TestClock.adjust(1000);
				expect(yield* h.next).toEqual(connected);
				yield* TestClock.adjust(30_000);
				yield* fake.failRead(new Error("disconnect"));
				yield* h.next;
				yield* h.next;
				yield* TestClock.adjust(999);
				expect(yield* fake.opens).toBe(2);
				yield* TestClock.adjust(1);
				expect(yield* h.next).toEqual(connected);
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
						yield* TestClock.adjust(2500);
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

it.scoped(
	"MAIN-046 MAIN-047 opens one scoped lifecycle owner per serial and releases removed serials",
	() =>
		Effect.gen(function* () {
			const second = {
				...FAKE_QUAKE_DEVICE,
				path: "fake-quake-second",
				serialNumber: "FAKE-QUAKE-SECOND",
			};
			const devices = [FAKE_QUAKE_DEVICE, second];
			const fake = yield* makeFakeHidTransport(devices);
			yield* Effect.gen(function* () {
				const harness = yield* makeHarness;
				yield* harness.next;
				const events: { serial: string; state: string }[] = [];
				const off = harness.bus.onLifecycleStatus?.((event, serial) =>
					events.push({ serial, state: event.state }),
				);
				yield* TestClock.adjust(1000);
				expect(yield* fake.opens).toBe(2);
				expect(events).toContainEqual({
					serial: second.serialNumber,
					state: "connected",
				});
				expect(harness.bus.device?.(second.serialNumber)?.serial?.()).toBe(
					second.serialNumber,
				);
				devices.splice(1, 1);
				yield* TestClock.adjust(7000);
				expect(events).toContainEqual({
					serial: second.serialNumber,
					state: "disconnected",
				});
				expect(yield* fake.closes).toBe(1);
				off?.();
				yield* harness.close;
				expect(yield* fake.closes).toBe(2);
			}).pipe(Effect.provide(withTransport(fake.layer)));
		}),
);

it.scoped(
	"MAIN-003 scans present paths at five seconds, missing at two, and debounces brief absence",
	() =>
		Effect.gen(function* () {
			const info = { ...FAKE_QUAKE_DEVICE, serialNumber: "A" };
			const touch = { ...TOUCH_IDENTITY, path: "fake:touch" };
			const fake = yield* makeFakeHidTransport([info, touch]);
			let present = true;
			let scans = 0;
			const layer = Layer.succeed(HidTransport, {
				...fake.transport,
				discover: () =>
					Effect.sync(() => {
						scans++;
						return present ? [info, touch] : [touch];
					}),
			});
			yield* Effect.gen(function* () {
				const h = yield* makeHarness;
				yield* h.next;
				// Let the independent touch poll bind before measuring control scans.
				yield* TestClock.adjust(2000);
				scans = 0;
				yield* TestClock.adjust(3999);
				expect(scans).toBe(0);
				present = false;
				yield* TestClock.adjust(1);
				expect(scans).toBe(1);
				expect(yield* fake.closes).toBe(0);
				yield* TestClock.adjust(1999);
				expect(scans).toBe(1);
				present = true;
				yield* TestClock.adjust(1);
				expect(scans).toBe(2);
				expect(yield* fake.opens).toBe(2);
				present = false;
				yield* TestClock.adjust(5000);
				expect(yield* fake.closes).toBe(0);
				yield* TestClock.adjust(2000);
				// Control teardown also closes its scoped touch handle.
				expect(yield* fake.closes).toBe(2);
			}).pipe(Effect.provide(withTransport(layer)));
		}),
);
it.scoped(
	"MAIN-011 closes every disappeared serial once and resolves ws aliases to the same bus",
	() =>
		Effect.gen(function* () {
			const two = yield* makeTwoStrips;
			two.devices.push(two.b);
			yield* Effect.gen(function* () {
				const h = yield* makeHarness;
				yield* h.next;
				yield* TestClock.adjust(1000);
				expect(h.bus.device?.("ws_A")).toBe(h.bus.device?.("A"));
				two.devices.length = 0;
				yield* TestClock.adjust(5000);
				expect(yield* two.first.closes).toBe(0);
				expect(yield* two.second.closes).toBe(0);
				yield* TestClock.adjust(2000);
				expect(yield* two.first.closes).toBe(1);
				expect(yield* two.second.closes).toBe(1);
				yield* h.close;
				expect(yield* two.first.closes).toBe(1);
				expect(yield* two.second.closes).toBe(1);
			}).pipe(Effect.provide(withTransport(two.layer)));
		}),
);

it.scoped(
	"SCREEN-013 forwards independent JSON and raw resources only under their serial identity",
	() =>
		Effect.gen(function* () {
			const two = yield* makeTwoStrips;
			two.devices.push(two.b);
			yield* Effect.gen(function* () {
				const h = yield* makeHarness;
				yield* h.next;
				yield* TestClock.adjust(1000);
				const a: QuakeEvent[] = [];
				const b: QuakeEvent[] = [];
				h.bus.on((event, serial) => {
					if (serial === "A") a.push(event);
					if (serial === "B") b.push(event);
				});
				const json = new Uint8Array(32);
				json.set([0xa1, 0, 7, 123, 34, 120, 34, 58, 49, 125, 33]);
				// Resource body: op=2, metadata=[1,2,8,0,0], sequence=0, JPEG marker bytes.
				const raw = new Uint8Array(32);
				raw.set([0xa2, 0, 11, 2, 1, 2, 8, 0, 0, 0, 255, 216, 255, 217, 191]);
				yield* two.first.emit(json);
				yield* two.second.emit(raw);
				yield* TestClock.adjust(0);
				expect(a.filter((e) => e.kind === "json")).toMatchObject([
					{ value: { x: 1 } },
				]);
				expect(a.some((e) => e.kind === "resource")).toBe(false);
				expect(b.filter((e) => e.kind === "resource")).toMatchObject([
					{
						envelope: {
							metadata: [1, 2, 8, 0, 0],
							payload: [255, 216, 255, 217],
						},
					},
				]);
				expect(b.some((e) => e.kind === "json")).toBe(false);
			}).pipe(Effect.provide(withTransport(two.layer)));
		}),
);

for (const target of ["A", "B"] as const) {
	for (const phase of ["discovery", "connect"] as const) {
		it.scoped(
			`VIA awaits ${target} reconnect ${phase} and leaves the other serial owned`,
			() =>
				Effect.gen(function* () {
					const two = yield* makeTwoStrips;
					two.devices.push(two.b);
					const transport = yield* HidTransport.pipe(Effect.provide(two.layer));
					const entered = yield* Deferred.make<void>();
					const proceed = yield* Deferred.make<void>();
					let armed = false;
					let settled = false;
					const gate = Effect.gen(function* () {
						armed = false;
						yield* Deferred.succeed(entered, undefined);
						yield* Deferred.await(proceed);
						settled = true;
					}).pipe(Effect.uninterruptible);
					const layer = Layer.succeed(HidTransport, {
						...transport,
						discover: () =>
							Effect.suspend(() =>
								armed && phase === "discovery"
									? gate.pipe(Effect.zipRight(transport.discover()))
									: transport.discover(),
							),
						open: (info) =>
							Effect.suspend(() =>
								armed && phase === "connect" && info.serialNumber === target
									? gate.pipe(Effect.zipRight(transport.open(info)))
									: transport.open(info),
							),
					});
					yield* Effect.gen(function* () {
						const h = yield* makeHarness;
						yield* h.next;
						yield* TestClock.adjust(1000);
						const bus = h.bus.device?.(target);
						expect(bus?.currentStatus()).toEqual(connected);
						if (!bus?.releaseForVia || !bus.recover)
							return yield* Effect.die("missing bus handoff");
						const selected = target === "A" ? two.first : two.second;
						const other = target === "A" ? two.second : two.first;
						yield* selected.failRead(new Error("reconnect fixture"));
						yield* TestClock.adjust(0);
						expect(yield* selected.closes).toBe(1);
						armed = true;
						yield* bus.recover();
						yield* TestClock.adjust(0);
						yield* Deferred.await(entered);
						let granted = false;
						const leasing = yield* bus.releaseForVia().pipe(
							Effect.tap(() =>
								Effect.sync(() => {
									granted = true;
								}),
							),
							Effect.fork,
						);
						yield* TestClock.adjust(0);
						expect(settled).toBe(false);
						expect(granted).toBe(false);
						yield* Deferred.succeed(proceed, undefined);
						const resume = yield* Fiber.join(leasing);
						expect(settled).toBe(true);
						expect(granted).toBe(true);
						expect(yield* selected.opens).toBe(yield* selected.closes);
						expect(yield* other.opens).toBe(1);
						expect(yield* other.closes).toBe(0);
						yield* TestClock.adjust(10_000);
						expect(yield* selected.opens).toBe(yield* selected.closes);
						yield* resume;
						yield* TestClock.adjust(0);
						expect(bus.currentStatus()).toEqual(connected);
						expect((yield* selected.opens) - (yield* selected.closes)).toBe(1);
						expect(yield* other.opens).toBe(1);
						yield* h.close;
						expect(yield* selected.opens).toBe(yield* selected.closes);
						expect(yield* other.closes).toBe(1);
					}).pipe(
						Effect.ensuring(Deferred.succeed(proceed, undefined)),
						Effect.provide(withTransport(layer)),
					);
				}),
		);
	}
}

it.scoped("cancelling a queued VIA handoff restores native reconnect", () =>
	Effect.gen(function* () {
		const fake = yield* makeFakeHidTransport();
		const entered = yield* Deferred.make<void>();
		const proceed = yield* Deferred.make<void>();
		let gated = true;
		const layer = Layer.succeed(HidTransport, {
			...fake.transport,
			open: (info) =>
				Effect.gen(function* () {
					if (gated) {
						gated = false;
						yield* Deferred.succeed(entered, undefined);
						yield* Deferred.await(proceed);
					}
					return yield* fake.transport.open(info);
				}),
		});
		yield* Effect.gen(function* () {
			const h = yield* makeHarness;
			yield* Deferred.await(entered);
			if (!h.bus.releaseForVia) return yield* Effect.die("missing bus handoff");
			const leasing = yield* h.bus.releaseForVia().pipe(Effect.fork);
			yield* TestClock.adjust(0);
			yield* Fiber.interrupt(leasing);
			yield* Deferred.succeed(proceed, undefined);
			expect(yield* h.next).toEqual(connected);
			yield* fake.end();
			yield* TestClock.adjust(1000);
			expect(h.bus.currentStatus()).toEqual(connected);
			expect(yield* fake.opens).toBe(2);
			expect(yield* fake.closes).toBe(1);
		}).pipe(
			Effect.ensuring(Deferred.succeed(proceed, undefined)),
			Effect.provide(withTransport(layer)),
		);
	}),
);
