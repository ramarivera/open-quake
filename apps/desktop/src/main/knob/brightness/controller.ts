import { Effect } from "effect";
import {
	KnobCapabilityUnavailable,
	KnobDispatchFailed,
	type KnobError,
} from "../../../../../../packages/device/src/knob/knob-errors.js";
export interface BrightnessReading {
	readonly target: string;
	readonly percent: number;
	/** Native device quantum, expressed in percent. */
	readonly quantum: number;
}
export interface BrightnessAdapter {
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
export function brightnessController(adapter: BrightnessAdapter) {
	const lock = Effect.unsafeMakeSemaphore(1);
	return Effect.fn("DesktopBrightness.step")(
		(
			delta: -1 | 1,
			guard: Effect.Effect<unknown, KnobError> = Effect.void,
		): Effect.Effect<void, KnobError> =>
			Effect.gen(function* () {
				yield* guard;
				const before = yield* adapter.read;
				if (!valid(before))
					return yield* KnobDispatchFailed.fromCause(
						new RangeError("Invalid brightness reading"),
					);
				const next = Math.max(0, Math.min(100, before.percent + delta * 5));
				if (next === before.percent) return;
				yield* guard;
				yield* adapter.write(before, next);
				const after = yield* adapter.read;
				if (
					!valid(after) ||
					after.target !== before.target ||
					after.quantum !== before.quantum ||
					delta * (after.percent - before.percent) <= 0 ||
					Math.abs(after.percent - next) >
						Math.max(before.quantum / 2 + 0.001, 1)
				)
					return yield* KnobDispatchFailed.fromCause(
						new RangeError("Brightness readback did not confirm the write"),
					);
			}).pipe(lock.withPermits(1)),
	);
}
export const unavailableBrightness: BrightnessAdapter = {
	read: Effect.fail(KnobCapabilityUnavailable.fromCause()),
	write: () => Effect.fail(KnobCapabilityUnavailable.fromCause()),
};
