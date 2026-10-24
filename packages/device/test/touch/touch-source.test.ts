import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Exit,
	Layer,
	Ref,
	Scope,
	Stream,
	TestClock,
} from "effect";
import {
	QuakeHidDiscoveryFailed,
	QuakeHidOpenFailed,
} from "../../src/device-errors.js";
import { FAKE_QUAKE_DEVICE, makeFakeHidTransport } from "../../src/hid-fake.js";
import { HidTransport } from "../../src/hid-transport.js";
import { type DeviceEvent, QuakeDevice } from "../../src/index.js";
import {
	TOUCH_IDENTITY,
	type TrackedTouchPoint,
} from "../../src/touch/touch-contracts.js";
import {
	SYNTHETIC_TOUCH_DOWN,
	SYNTHETIC_TOUCH_EMPTY,
} from "../../src/touch/touch-fixtures.js";
import { makeTouchSession } from "../../src/touch/touch-session.js";
import { startTouchSource } from "../../src/touch/touch-source.js";

const info = { path: "fake:touch", ...TOUCH_IDENTITY };

describe("scoped vendor input", () => {
	it.scoped(
		"100ms deadline, invalid reports, capture, explicit lift and no stale duplicate",
		() =>
			Effect.gen(function* () {
				const events = yield* Ref.make<
					readonly (readonly TrackedTouchPoint[])[]
				>([]);
				const session = yield* makeTouchSession((points) =>
					Ref.update(events, (old) => [...old, points]),
				);
				yield* session.report(SYNTHETIC_TOUCH_DOWN);
				yield* TestClock.adjust(99);
				expect(yield* Ref.get(events)).toHaveLength(1);
				yield* session.report(new Uint8Array());
				yield* TestClock.adjust(1);
				expect((yield* Ref.get(events)).at(-1)?.[0]?.action).toBe(0);
				yield* TestClock.adjust(1000);
				expect(yield* Ref.get(events)).toHaveLength(2);
				yield* session.setCaptureActive(true);
				yield* session.report(SYNTHETIC_TOUCH_DOWN);
				yield* TestClock.adjust(1000);
				expect(yield* Ref.get(events)).toHaveLength(3);
				yield* session.report(SYNTHETIC_TOUCH_EMPTY);
				expect((yield* Ref.get(events)).at(-1)?.[0]?.action).toBe(0);
				yield* session.report(SYNTHETIC_TOUCH_DOWN);
				yield* session.setCaptureActive(false);
				yield* TestClock.adjust(99);
				expect(yield* Ref.get(events)).toHaveLength(5);
				yield* TestClock.adjust(1);
				expect(yield* Ref.get(events)).toHaveLength(6);
			}),
	);
	it.scoped(
		"binds once, closes on read error, releases contacts and rebinds in 2s",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport([info, info]);
				const events = yield* Ref.make<
					readonly (readonly TrackedTouchPoint[])[]
				>([]);
				const received = yield* Deferred.make<void>();
				const source = yield* startTouchSource(fake.transport, (points) =>
					Ref.update(events, (old) => [...old, points]).pipe(
						Effect.zipRight(Deferred.succeed(received, undefined)),
						Effect.asVoid,
					),
				);
				yield* TestClock.adjust(1999);
				expect(yield* fake.opens).toBe(0);
				yield* TestClock.adjust(1);
				expect(yield* fake.opens).toBe(1);
				yield* source.setCaptureActive(true);
				yield* fake.emit(SYNTHETIC_TOUCH_DOWN);
				yield* Deferred.await(received);
				yield* fake.failRead(new Error("Bearer SECRET DevSrvsID:123"));
				yield* TestClock.adjust(0);
				expect(yield* fake.closes).toBe(1);
				expect((yield* Ref.get(events)).at(-1)?.[0]?.action).toBe(0);
				expect(yield* source.health).toMatchObject({
					state: "HID_READ_FAILED",
					reports: 1,
					frames: 1,
					errorCode: "QUAKE.HID.READ_FAILED",
				});
				expect(JSON.stringify(yield* source.health)).not.toContain("SECRET");
				yield* TestClock.adjust(1999);
				expect(yield* fake.opens).toBe(1);
				yield* TestClock.adjust(1);
				expect(yield* fake.opens).toBe(2);
			}),
	);
	it.scoped(
		"empty enumeration escalates after five attempts, cancels on scope close",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport([]);
				const scope = yield* Scope.make();
				const source = yield* Scope.extend(
					startTouchSource(fake.transport, () => Effect.void),
					scope,
				);
				yield* TestClock.adjust(10000);
				expect(yield* source.health).toMatchObject({
					state: "RECOVERING",
					bindAttempts: 5,
					recoveryCycle: 1,
				});
				yield* TestClock.adjust(59999);
				expect((yield* source.health).bindAttempts).toBe(5);
				yield* TestClock.adjust(1);
				expect((yield* source.health).bindAttempts).toBe(6);
				yield* Scope.close(scope, Exit.void);
				yield* TestClock.adjust(100000);
				expect((yield* source.health).bindAttempts).toBe(6);
			}),
	);
	it.scoped(
		"lock defers binding and newer wake generations cancel old attempts",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport([info]);
				const source = yield* startTouchSource(
					fake.transport,
					() => Effect.void,
				);
				yield* source.setLocked(true);
				yield* TestClock.adjust(10000);
				expect(yield* fake.opens).toBe(0);
				yield* source.wake();
				yield* TestClock.adjust(10000);
				expect(yield* fake.opens).toBe(0);
				yield* source.setLocked(false);
				yield* TestClock.adjust(1000);
				yield* source.wake();
				yield* TestClock.adjust(1499);
				expect(yield* fake.opens).toBe(0);
				yield* TestClock.adjust(1);
				expect(yield* fake.opens).toBe(1);
				yield* source.wake();
				expect(yield* fake.closes).toBe(1);
			}),
	);
	it.scoped(
		"wake's second failed attempt waits 4500ms, wrong collection never opens",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport([
					{ ...info, usagePage: 0x0d, usage: 4 },
				]);
				const source = yield* startTouchSource(
					fake.transport,
					() => Effect.void,
				);
				yield* source.wake();
				yield* TestClock.adjust(1500);
				expect(yield* source.health).toMatchObject({
					state: "DK_TARGET_NOT_FOUND",
					bindAttempts: 1,
				});
				yield* TestClock.adjust(4499);
				expect((yield* source.health).bindAttempts).toBe(1);
				yield* TestClock.adjust(1);
				expect((yield* source.health).bindAttempts).toBe(2);
				expect(yield* fake.opens).toBe(0);
			}),
	);
	it.scoped(
		"discovery and open failures retain safe catalog codes without raw diagnostics",
		() =>
			Effect.gen(function* () {
				for (const failure of ["discover", "open"] as const) {
					const fake = yield* makeFakeHidTransport([info]);
					const source = yield* startTouchSource(
						{
							...fake.transport,
							discover:
								failure === "discover"
									? () =>
											Effect.fail(
												new QuakeHidDiscoveryFailed(new Error("sk-secret")),
											)
									: fake.transport.discover,
							open:
								failure === "open"
									? () =>
											Effect.fail(
												new QuakeHidOpenFailed(new Error("sk-secret")),
											)
									: fake.transport.open,
						},
						() => Effect.void,
					);
					yield* TestClock.adjust(2000);
					expect(yield* source.health).toMatchObject({
						state:
							failure === "discover"
								? "HID_ENUM_EMPTY"
								: "DK_TARGET_OPEN_FAILED",
					});
					expect(JSON.stringify(yield* source.health)).not.toContain(
						"sk-secret",
					);
				}
			}),
	);
	it.scoped(
		"QuakeDevice delivers vendor contacts while keeping control open and never writes touch",
		() =>
			Effect.gen(function* () {
				const control = yield* makeFakeHidTransport();
				const touch = yield* makeFakeHidTransport([info]);
				const transport = HidTransport.of({
					discover: () => Effect.succeed([FAKE_QUAKE_DEVICE, info]),
					open: (device) =>
						device.path === info.path
							? touch.transport.open(device)
							: control.transport.open(device),
				});
				yield* Effect.gen(function* () {
					const connection = yield* (yield* QuakeDevice).connect();
					const subscription = yield* connection.subscribe();
					const events = yield* Ref.make<readonly DeviceEvent[]>([]);
					const received = yield* Deferred.make<void>();
					yield* Stream.runForEach(subscription, (event) =>
						Ref.update(events, (old) => [...old, event]).pipe(
							Effect.zipRight(Deferred.succeed(received, undefined)),
						),
					).pipe(Effect.forkScoped);
					yield* TestClock.adjust(2000);
					yield* touch.emit(SYNTHETIC_TOUCH_DOWN);
					yield* Deferred.await(received);
					expect((yield* Ref.get(events))[0]).toMatchObject({
						_tag: "Touch",
						points: [{ touchId: "touch-1", action: 1, x: 120, y: 360 }],
					});
					yield* TestClock.adjust(100);
					expect((yield* Ref.get(events)).at(-1)).toMatchObject({
						_tag: "Touch",
						points: [{ action: 0 }],
					});
					expect(yield* control.closes).toBe(0);
					expect(yield* touch.writes).toEqual([]);
					yield* connection.disconnect();
					expect(yield* touch.closes).toBe(1);
					expect(yield* control.closes).toBe(1);
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(Layer.succeed(HidTransport, transport)),
						),
					),
				);
			}),
	);
});
