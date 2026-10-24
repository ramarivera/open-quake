import { Effect, Fiber, Option, type Scope, Stream } from "effect";
import type { HidTransport } from "../hid-transport.js";
import {
	isTouchDevice,
	TOUCH_IDENTITY,
	type TouchHealth,
	type TouchState,
	type TrackedTouchPoint,
} from "./touch-contracts.js";
import { touchRecoveryDelay } from "./touch-invariants.js";
import { makeTouchSession } from "./touch-session.js";

/** Lifecycle helper owned by QuakeDevice; infrastructure is injected, never global. */
export const startTouchSource = Effect.fn("TouchInput.start")(function* (
	transport: HidTransport["Type"],
	emit: (points: readonly TrackedTouchPoint[]) => Effect.Effect<void>,
): Effect.fn.Return<
	{
		readonly health: Effect.Effect<TouchHealth>;
		readonly setCaptureActive: (active: boolean) => Effect.Effect<void>;
		readonly setLocked: (locked: boolean) => Effect.Effect<void>;
		readonly wake: () => Effect.Effect<void>;
	},
	never,
	Scope.Scope
> {
	const session = yield* makeTouchSession(emit);
	const scope = yield* Effect.scope;
	const serial = yield* Effect.makeSemaphore(1);
	let health: TouchHealth = {
		state: "UNKNOWN",
		reports: 0,
		frames: 0,
		bindAttempts: 0,
		recoveryCycle: 0,
	};
	let locked = false;
	let worker = Option.none<Fiber.RuntimeFiber<void>>();
	const state = (state: TouchState, errorCode?: string): void => {
		const { errorCode: _previous, ...counters } = health;
		health = { ...counters, state, ...(errorCode ? { errorCode } : {}) };
	};
	const bind = Effect.gen(function* () {
		health = { ...health, bindAttempts: health.bindAttempts + 1 };
		const discovered = yield* Effect.either(transport.discover());
		if (discovered._tag === "Left") {
			state("HID_ENUM_EMPTY", discovered.left.code);
			return false;
		}
		const unique = new Map(
			discovered.right
				.filter(
					(device) =>
						device.vendorId === TOUCH_IDENTITY.vendorId &&
						device.productId === TOUCH_IDENTITY.productId,
				)
				.map((device) => [
					`${device.path}:${device.usagePage}:${device.usage}`,
					device,
				]),
		);
		if (!unique.size) {
			state("HID_ENUM_EMPTY");
			return false;
		}
		const info = [...unique.values()].find(isTouchDevice);
		if (!info) {
			state("DK_TARGET_NOT_FOUND");
			return false;
		}
		return yield* Effect.scoped(
			Effect.gen(function* () {
				const opened = yield* Effect.either(transport.open(info));
				if (opened._tag === "Left") {
					state("DK_TARGET_OPEN_FAILED", opened.left.code);
					return false;
				}
				const handle = opened.right;
				yield* Effect.addFinalizer(() =>
					handle
						.close()
						.pipe(
							Effect.catchTag("QuakeHidCloseFailed", (error) =>
								Effect.sync(() => state("HID_READ_FAILED", error.code)),
							),
						),
				);
				yield* Effect.addFinalizer(session.release);
				state("TOUCH_OK");
				health = { ...health, recoveryCycle: 0 };
				yield* Stream.runForEach(handle.reports, (bytes) =>
					Effect.gen(function* () {
						health = { ...health, reports: health.reports + 1 };
						if (yield* session.report(bytes))
							health = { ...health, frames: health.frames + 1 };
					}),
				).pipe(
					Effect.catchTag("QuakeHidReadFailed", (error) =>
						Effect.sync(() => state("HID_READ_FAILED", error.code)),
					),
				);
				if (health.state === "TOUCH_OK") state("HID_READ_FAILED");
				return true;
			}),
		);
	});
	const supervise = (wake: boolean): Effect.Effect<void> =>
		Effect.gen(function* () {
			let failures = 0;
			let wakeRetry = wake;
			if (wake) yield* Effect.sleep(1500);
			while (true) {
				const wasBound = yield* bind;
				if (wasBound) {
					failures = 0;
					wakeRetry = false;
					yield* Effect.sleep(2000);
					continue;
				}
				failures++;
				if (wakeRetry) {
					wakeRetry = false;
					yield* Effect.sleep(4500);
					continue;
				}
				if (failures >= 5) {
					const delay = touchRecoveryDelay(
						health.recoveryCycle,
						health.state === "HID_ENUM_EMPTY",
					);
					health = { ...health, recoveryCycle: health.recoveryCycle + 1 };
					state("RECOVERING");
					failures = 0;
					yield* Effect.sleep(delay);
				} else yield* Effect.sleep(2000);
			}
		});
	const restart = (wake: boolean): Effect.Effect<void> =>
		Effect.gen(function* () {
			if (Option.isSome(worker)) yield* Fiber.interrupt(worker.value);
			worker = Option.none();
			yield* session.release();
			if (locked) return;
			health = { ...health, recoveryCycle: 0 };
			state(wake ? "RECOVERING" : "UNKNOWN");
			worker = Option.some(yield* supervise(wake).pipe(Effect.forkIn(scope)));
		});
	// DK-Suite's first poll is after 2 seconds.
	worker = Option.some(
		yield* Effect.sleep(2000).pipe(
			Effect.zipRight(supervise(false)),
			Effect.forkIn(scope),
		),
	);
	return {
		health: Effect.sync(() => ({ ...health })),
		setCaptureActive: session.setCaptureActive,
		setLocked: Effect.fn("TouchInput.setLocked")(
			(value: boolean): Effect.Effect<void> =>
				serial.withPermits(1)(
					Effect.gen(function* () {
						locked = value;
						yield* restart(!value);
					}),
				),
		),
		wake: Effect.fn("TouchInput.wake")(
			(): Effect.Effect<void> => serial.withPermits(1)(restart(true)),
		),
	};
});
