import { Clock, Deferred, Effect } from "effect";
import {
	KnobCapabilityUnavailable,
	KnobDispatchFailed,
	type KnobError,
} from "../../../../../../packages/device/src/knob/knob-errors.js";
export interface BrightnessReading {
	readonly target: string;
	readonly percent: number;
	readonly quantum: number;
}
export interface BrightnessAdapter {
	readonly smooth?: boolean;
	readonly read: Effect.Effect<BrightnessReading, KnobError>;
	readonly write: (
		reading: BrightnessReading,
		percent: number,
	) => Effect.Effect<void, KnobError>;
}
const valid = (reading: BrightnessReading) =>
	reading.target.length > 0 &&
	Number.isFinite(reading.percent) &&
	reading.percent >= 0 &&
	reading.percent <= 100 &&
	Number.isFinite(reading.quantum) &&
	reading.quantum > 0 &&
	reading.quantum <= 100;
interface Request {
	readonly delta: -1 | 1;
	canceled: boolean;
	readonly guard: Effect.Effect<unknown, KnobError>;
	readonly result: Deferred.Deferred<void, KnobError>;
}
/** A burst retains logical detents and shares one awaited, interruptible native writer. */
export function brightnessController(adapter: BrightnessAdapter) {
	const lock = Effect.unsafeMakeSemaphore(1);
	let pending: Request[] = [];
	let running = false;
	let active: Request[] = [];
	let lastWrite = -Infinity;
	const apply = (batch: readonly Request[]) =>
		Effect.gen(function* () {
			for (const request of batch) if (!request.canceled) yield* request.guard;
			let before = yield* adapter.read;
			if (!valid(before))
				return yield* KnobDispatchFailed.fromCause(
					new RangeError("Invalid brightness reading"),
				);
			const initial = before.percent;
			const targetForActive = () => {
				let target = initial;
				for (const request of batch)
					if (!request.canceled)
						target = Math.max(0, Math.min(100, target + request.delta * 5));
				return target;
			};
			let target = targetForActive();
			if (target === before.percent) return;
			const now = yield* Clock.currentTimeMillis;
			yield* Effect.sleep(
				Number.isFinite(lastWrite) ? Math.max(0, 500 - (now - lastWrite)) : 1,
			);
			lastWrite = yield* Clock.currentTimeMillis;
			do {
				if (batch.every((request) => request.canceled)) return;
				for (const request of batch)
					if (!request.canceled) yield* request.guard;
				target = targetForActive();
				if (target === before.percent) return;
				const remaining = target - before.percent;
				const next =
					adapter.smooth && Math.abs(remaining) >= 0.5
						? before.percent + remaining * 0.2
						: target;
				yield* adapter.write(before, next);
				const after = yield* adapter.read;
				if (
					!valid(after) ||
					after.target !== before.target ||
					after.quantum !== before.quantum ||
					Math.sign(remaining) * (after.percent - before.percent) <= 0 ||
					Math.abs(after.percent - next) >
						Math.max(before.quantum / 2 + 0.001, 1)
				)
					return yield* KnobDispatchFailed.fromCause(
						new RangeError("Brightness readback did not confirm the write"),
					);
				before = after;
				if (next === target) return;
				yield* Effect.sleep(16);
			} while (true);
		});
	const drain: Effect.Effect<void> = Effect.suspend(() =>
		Effect.gen(function* () {
			while (pending.length) {
				const batch = pending.filter((r) => !r.canceled);
				active = batch;
				pending = [];
				const result = yield* Effect.exit(apply(batch));
				for (const request of batch)
					yield* Deferred.done(request.result, result);
				active = [];
			}
		}).pipe(
			Effect.ensuring(
				Effect.gen(function* () {
					running = false;
					const abandoned = [...active, ...pending];
					active = [];
					pending = [];
					for (const request of abandoned)
						yield* Deferred.fail(
							request.result,
							KnobDispatchFailed.fromCause(
								new Error("Brightness update interrupted"),
							),
						);
				}),
			),
		),
	);
	return Effect.fn("DesktopBrightness.step")(
		(
			delta: -1 | 1,
			guard: Effect.Effect<unknown, KnobError> = Effect.void,
		): Effect.Effect<void, KnobError> =>
			Effect.gen(function* () {
				yield* guard;
				const result = yield* Deferred.make<void, KnobError>();
				const request: Request = { delta, guard, result, canceled: false };
				const leader = yield* lock.withPermits(1)(
					Effect.sync(() => {
						pending.push(request);
						if (running) return false;
						running = true;
						return true;
					}),
				);
				return yield* (
					leader
						? Effect.yieldNow().pipe(
								Effect.zipRight(drain),
								Effect.zipRight(Deferred.await(result)),
							)
						: Deferred.await(result)
				).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							request.canceled = true;
							pending = pending.filter((r) => r !== request);
						}),
					),
				);
			}),
	);
}
export const unavailableBrightness: BrightnessAdapter = {
	read: Effect.fail(KnobCapabilityUnavailable.fromCause()),
	write: () => Effect.fail(KnobCapabilityUnavailable.fromCause()),
};
