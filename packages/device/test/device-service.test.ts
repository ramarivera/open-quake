import { describe, expect, it } from "@effect/vitest";
import {
	Chunk,
	Deferred,
	Effect,
	Either,
	Exit,
	Fiber,
	Layer,
	Ref,
	Scope,
	Stream,
	TestClock,
} from "effect";
import { FAKE_QUAKE_DEVICE, makeFakeHidTransport } from "../src/hid-fake.js";
import {
	type DeviceEvent,
	type HidDeviceInfo,
	HidTransport,
	QuakeDevice,
} from "../src/index.js";
import { report } from "./reports.js";

describe("QuakeDevice conductor", () => {
	it.scoped(
		"keeps reading and writing after an unknown opcode with command 26",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				yield* Effect.gen(function* () {
					const connection = yield* (yield* QuakeDevice).connect();
					const events = yield* connection.subscribe();
					const consumer = yield* Stream.runCollect(
						events.pipe(Stream.take(1)),
					).pipe(Effect.either, Effect.forkScoped);
					yield* fake.emit(report(0x55, 26));
					yield* fake.emit(report(3, 2, [1]));
					const result = yield* Fiber.join(consumer);
					expect(
						Either.isRight(result) && Chunk.toReadonlyArray(result.right),
					).toEqual([{ _tag: "KnobPress", state: 1 }]);
					yield* TestClock.adjust(15_000);
					expect(yield* fake.closes).toBe(0);
					expect(yield* fake.writes).toHaveLength(1);
					yield* connection.disconnect();
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
			}),
	);
	it.scoped(
		"sends 33-byte keep-alives on the configured cadence, then stops and closes exactly once",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				yield* Effect.gen(function* () {
					const device = yield* QuakeDevice;
					expect(Array.from(yield* device.keepAlivePing)).toEqual([
						0xa3, 2, 2, 0xef, 0xf1,
					]);
					const connection = yield* device.connect({
						keepAliveIntervalMs: 1000,
					});
					expect(yield* fake.writes).toHaveLength(0);
					yield* TestClock.adjust(999);
					expect(yield* fake.writes).toHaveLength(0);
					yield* TestClock.adjust(1);
					expect(yield* fake.writes).toHaveLength(1);
					const expected = [
						0,
						0xa3,
						2,
						2,
						0xef,
						0xf1,
						...Array<number>(27).fill(0),
					];
					expect(Array.from((yield* fake.writes)[0] ?? [])).toEqual(expected);
					yield* TestClock.adjust(2000);
					expect(yield* fake.writes).toHaveLength(3);
					yield* connection.disconnect();
					yield* connection.disconnect();
					yield* TestClock.adjust(10_000);
					expect(yield* fake.writes).toHaveLength(3);
					expect(yield* fake.closes).toBe(1);
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
			}),
	);
	it.scoped(
		"scope close cancels the default 15-second keep-alive and releases the handle",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				yield* Effect.gen(function* () {
					const scope = yield* Scope.make();
					const device = yield* QuakeDevice;
					yield* Scope.extend(device.connect(), scope);
					yield* TestClock.adjust(15_000);
					expect(yield* fake.writes).toHaveLength(1);
					yield* Scope.close(scope, Exit.void);
					expect(yield* fake.closes).toBe(1);
					yield* TestClock.adjust(30_000);
					expect(yield* fake.writes).toHaveLength(1);
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
			}),
	);
	it.scoped(
		"decodes padded control reports and broadcasts events to both subscribers",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				yield* Effect.gen(function* () {
					const device = yield* QuakeDevice;
					const connection = yield* device.connect();
					const streamA = yield* connection.subscribe();
					const streamB = yield* connection.subscribe();
					const gotInputs = yield* Deferred.make<void>();
					const a = yield* Stream.runCollect(
						streamA.pipe(
							Stream.tap((event) =>
								event._tag === "KeepAlive"
									? Deferred.succeed(gotInputs, undefined)
									: Effect.void,
							),
						),
					).pipe(Effect.forkScoped);
					const b = yield* Stream.runCollect(streamB).pipe(Effect.forkScoped);
					for (const bytes of [
						report(3, 1, [1]),
						report(3, 1, [0], true),
						report(3, 2, [1]),
						report(0xa3, 26, [1, 2, 0x34, 0x01, 0x78, 0x05]),
						report(0x55, 0xef),
					]) {
						yield* fake.emit(bytes);
					}
					yield* Deferred.await(gotInputs);
					yield* device.disconnect(connection);
					const expected: ReadonlyArray<DeviceEvent> = [
						{ _tag: "KnobRotate", delta: 1 },
						{ _tag: "KnobRotate", delta: -1 },
						{ _tag: "KnobPress", state: 1 },
						{ _tag: "Touch", points: [{ action: 2, y: 308, x: 1400 }] },
						{ _tag: "KeepAlive" },
						{ _tag: "Disconnect", reason: "requested" },
					];
					expect(Chunk.toReadonlyArray(yield* Fiber.join(a))).toEqual(expected);
					expect(Chunk.toReadonlyArray(yield* Fiber.join(b))).toEqual(expected);
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
			}),
	);
	it.scoped(
		"rejects missing devices and mismatches in each USB identity field",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport([
					{ ...FAKE_QUAKE_DEVICE, vendorId: 0 },
					{ ...FAKE_QUAKE_DEVICE, productId: 0 },
					{ ...FAKE_QUAKE_DEVICE, usagePage: 0 },
					{ ...FAKE_QUAKE_DEVICE, usage: 0 },
				]);
				const result = yield* Effect.gen(function* () {
					return yield* Effect.either((yield* QuakeDevice).connect());
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
				expect(Either.isLeft(result) && result.left._tag).toBe(
					"QuakeDeviceNotFound",
				);
				expect(Either.isLeft(result) && result.left.code).toBe(
					"QUAKE.DEVICE.NOT_FOUND",
				);
				expect(yield* fake.opens).toBe(0);
			}),
	);
	it.scoped("rejects invalid intervals before opening a device", () =>
		Effect.gen(function* () {
			const fake = yield* makeFakeHidTransport();
			yield* Effect.gen(function* () {
				const device = yield* QuakeDevice;
				for (const keepAliveIntervalMs of [
					0,
					-1,
					Number.NaN,
					Number.POSITIVE_INFINITY,
				]) {
					const result = yield* Effect.either(
						device.connect({ keepAliveIntervalMs }),
					);
					expect(Either.isLeft(result) && result.left._tag).toBe(
						"QuakeConnectionConfigInvalid",
					);
				}
			}).pipe(
				Effect.provide(
					QuakeDevice.DefaultWithoutDependencies.pipe(
						Layer.provide(fake.layer),
					),
				),
			);
			expect(yield* fake.opens).toBe(0);
		}),
	);
	it.scoped(
		"disconnect waits for an in-flight write before closing its handle",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				const writing = yield* Deferred.make<void>();
				const finishWrite = yield* Deferred.make<void>();
				const transport = Layer.succeed(HidTransport, {
					...fake.transport,
					open: (info: HidDeviceInfo) =>
						Effect.map(fake.transport.open(info), (handle) => ({
							...handle,
							write: (bytes: Uint8Array) =>
								Deferred.succeed(writing, undefined).pipe(
									Effect.zipRight(Deferred.await(finishWrite)),
									Effect.zipRight(handle.write(bytes)),
								),
						})),
				});
				yield* Effect.gen(function* () {
					const connection = yield* (yield* QuakeDevice).connect({
						keepAliveIntervalMs: 100,
					});
					const advance = yield* TestClock.adjust(1000).pipe(Effect.forkScoped);
					yield* Deferred.await(writing);
					const disconnecting = yield* connection
						.disconnect()
						.pipe(Effect.forkScoped);
					expect(yield* fake.closes).toBe(0);
					yield* Deferred.succeed(finishWrite, undefined);
					yield* Fiber.join(advance);
					yield* Fiber.join(disconnecting);
					expect(yield* fake.closes).toBe(1);
					expect(yield* fake.writes).toHaveLength(1);
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(transport),
						),
					),
				);
			}),
	);
	for (const shutdown of ["disconnect", "scope-close"] as const) {
		it.scoped(`drains a cancelled hardware write before ${shutdown}`, () =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				const writing = yield* Deferred.make<void>();
				const finishWrite = yield* Deferred.make<void>();
				const transport = Layer.succeed(HidTransport, {
					...fake.transport,
					open: (info: HidDeviceInfo) =>
						Effect.map(fake.transport.open(info), (handle) => ({
							...handle,
							write: (bytes: Uint8Array) =>
								Deferred.succeed(writing, undefined).pipe(
									Effect.zipRight(Deferred.await(finishWrite)),
									Effect.zipRight(handle.write(bytes)),
								),
						})),
				});
				yield* Effect.gen(function* () {
					const scope = yield* Scope.make();
					const connection = yield* Scope.extend(
						(yield* QuakeDevice).connect(),
						scope,
					);
					const sending = yield* connection
						.sendHardware({ _tag: "Mic", on: false })
						.pipe(Effect.fork);
					yield* Deferred.await(writing);
					const cancelling = yield* Fiber.interrupt(sending).pipe(Effect.fork);
					const closing = yield* (
						shutdown === "disconnect"
							? connection.disconnect()
							: Scope.close(scope, Exit.void)
					).pipe(Effect.fork);
					yield* TestClock.adjust(0);
					const earlyCloses = yield* fake.closes;
					yield* Deferred.succeed(finishWrite, undefined);
					yield* Fiber.join(cancelling);
					yield* Fiber.join(closing);
					yield* Scope.close(scope, Exit.void);
					expect(earlyCloses).toBe(0);
					expect(yield* fake.writes).toHaveLength(1);
					expect(yield* fake.closes).toBe(1);
					const afterClose = yield* connection
						.sendHardware({ _tag: "Mic", on: true })
						.pipe(Effect.either);
					expect(Either.isLeft(afterClose) && afterClose.left._tag).toBe(
						"QuakeConnectionClosed",
					);
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(transport),
						),
					),
				);
			}),
		);
	}
	it.scoped(
		"interrupting connect during acquisition still closes a successfully opened handle",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				const acquiring = yield* Deferred.make<void>();
				const allowOpen = yield* Deferred.make<void>();
				const transport = Layer.succeed(HidTransport, {
					...fake.transport,
					open: (info: HidDeviceInfo) =>
						Deferred.succeed(acquiring, undefined).pipe(
							Effect.zipRight(Deferred.await(allowOpen)),
							Effect.zipRight(fake.transport.open(info)),
						),
				});
				yield* Effect.gen(function* () {
					const connecting = yield* (yield* QuakeDevice)
						.connect()
						.pipe(Effect.forkScoped);
					yield* Deferred.await(acquiring);
					const interrupting = yield* Fiber.interrupt(connecting).pipe(
						Effect.forkScoped,
					);
					yield* Deferred.succeed(allowOpen, undefined);
					yield* Fiber.join(interrupting);
					expect(yield* fake.opens).toBe(1);
					expect(yield* fake.closes).toBe(1);
					yield* TestClock.adjust(30_000);
					expect(yield* fake.writes).toHaveLength(0);
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(transport),
						),
					),
				);
			}),
	);
	it.scoped(
		"malformed input fails the event stream and releases the transport",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				yield* Effect.gen(function* () {
					const connection = yield* (yield* QuakeDevice).connect();
					const events = yield* connection.subscribe();
					const consumer = yield* Stream.runDrain(events).pipe(
						Effect.either,
						Effect.forkScoped,
					);
					yield* fake.emit(report(3, 1));
					const result = yield* Fiber.join(consumer);
					expect(Either.isLeft(result) && result.left._tag).toBe(
						"FrameSizeInvalid",
					);
					expect(yield* fake.closes).toBe(1);
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
			}),
	);
	for (const kind of ["read", "write", "end"] as const) {
		it.scoped(`stops and closes after transport ${kind}`, () =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				const original = new Error("token=private-device-secret");
				yield* Effect.gen(function* () {
					const connection = yield* (yield* QuakeDevice).connect({
						keepAliveIntervalMs: 100,
					});
					const received = yield* Ref.make<ReadonlyArray<DeviceEvent>>([]);
					const events = yield* connection.subscribe();
					const consumer = yield* Stream.runForEach(events, (event) =>
						Ref.update(received, (events) => [...events, event]),
					).pipe(Effect.either, Effect.forkScoped);
					if (kind === "read") yield* fake.failRead(original);
					else if (kind === "write") {
						yield* fake.failWrite(original);
						yield* TestClock.adjust(2500);
					} else yield* fake.end();
					const result = yield* Fiber.join(consumer);
					expect(yield* received).toEqual([
						{
							_tag: "Disconnect",
							reason: kind === "end" ? "transport-ended" : "error",
						},
					]);
					if (kind === "end") expect(Either.isRight(result)).toBe(true);
					else {
						expect(Either.isLeft(result)).toBe(true);
						if (Either.isLeft(result)) {
							expect(result.left._tag).toBe(
								kind === "read" ? "QuakeHidReadFailed" : "QuakeHidWriteFailed",
							);
							expect(
								"originalCause" in result.left && result.left.originalCause,
							).toBe(original);
							expect(JSON.stringify(result.left)).not.toContain(
								"private-device-secret",
							);
						}
					}
					expect(yield* fake.closes).toBe(1);
					yield* TestClock.adjust(1000);
					expect(yield* fake.writes).toHaveLength(0);
					// Subscribers arriving after termination finish without hanging.
					expect(
						Either.isLeft(
							yield* Effect.either(Stream.runDrain(connection.events)),
						),
					).toBe(kind !== "end");
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
			}),
		);
	}
});
