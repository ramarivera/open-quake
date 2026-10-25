import { Cause, Effect, Exit, Option } from "effect";
import {
	AudioOutputBusy,
	type AudioOutputError,
	AudioOutputFailed,
} from "./output-errors.js";

export type AudioOutputOwner = "soundboard" | "speech" | "capture";
export interface AudioOutputLease {
	/** Check before and after asynchronous native acquisition. Preemption invalidates immediately. */
	readonly current: Effect.Effect<boolean>;
	/** Idempotent; stops only this lease's resources, including after replacement. */
	readonly release: Effect.Effect<void>;
}
interface Reservation {
	readonly owner: AudioOutputOwner;
	valid: boolean;
	readonly stop: Effect.Effect<void, AudioOutputFailed>;
}

/** One instance per app. Acquiring it opens no output device or worker. */
export const makeAudioOutput = Effect.gen(function* () {
	const gate = yield* Effect.makeSemaphore(1);
	let active: Reservation | undefined;
	let closed = false;
	let unsafe: AudioOutputFailed | undefined;
	const stop = Effect.fn("AudioOutput.stop")(function* (
		reservation: Reservation,
	): Effect.fn.Return<void, AudioOutputFailed> {
		reservation.valid = false;
		const result = yield* Effect.exit(reservation.stop);
		if (Exit.isFailure(result)) {
			unsafe = Option.getOrElse(
				Cause.failureOption(result.cause),
				() => new AudioOutputFailed(Cause.squash(result.cause)),
			);
			return yield* unsafe;
		}
	});
	const release = (reservation: Reservation): Effect.Effect<void> =>
		Effect.uninterruptible(
			Effect.gen(function* () {
				// Retain ownership until native teardown finishes, so another soundboard cannot sneak in.
				yield* stop(reservation).pipe(
					Effect.catchTag("AudioOutputFailed", (error) =>
						Effect.logWarning(error),
					),
				);
				if (active === reservation) active = undefined;
			}),
		);
	const acquire = Effect.fn("AudioOutput.acquire")(function* (
		owner: AudioOutputOwner,
		onPreempt: Effect.Effect<void>,
	): Effect.fn.Return<AudioOutputLease, AudioOutputError> {
		let acquired: Reservation | undefined;
		return yield* gate
			.withPermits(1)(
				Effect.uninterruptible(
					Effect.gen(function* () {
						if (unsafe) return yield* unsafe;
						if (closed) return yield* new AudioOutputFailed();
						const previous = active;
						if (
							previous &&
							(owner === "soundboard" || previous.owner === "capture")
						)
							return yield* new AudioOutputBusy();
						const cleanup = yield* Effect.cached(
							onPreempt.pipe(
								Effect.interruptible,
								Effect.timeout("2 seconds"),
								Effect.catchAllCause((cause) =>
									Effect.fail(
										new AudioOutputFailed(
											Cause.originalError(
												Option.getOrElse(Cause.dieOption(cause), () =>
													Cause.squash(cause),
												),
											),
										),
									),
								),
							),
						);
						const reservation: Reservation = {
							owner,
							stop: cleanup,
							valid: true,
						};
						acquired = reservation;
						// Reserve before awaiting teardown. Voice blocks new soundboard starts immediately.
						active = reservation;
						if (previous) {
							const stopped = yield* Effect.exit(stop(previous));
							if (Exit.isFailure(stopped)) {
								yield* release(reservation);
								return yield* Effect.failCause(stopped.cause);
							}
						}
						if (active !== reservation || closed) {
							yield* release(reservation);
							return yield* new AudioOutputBusy();
						}
						return {
							current: Effect.sync(
								() =>
									active === reservation &&
									reservation.valid &&
									!closed &&
									!unsafe,
							),
							release: release(reservation),
						};
					}),
				),
			)
			.pipe(
				Effect.onInterrupt(() => (acquired ? release(acquired) : Effect.void)),
			);
	});
	return {
		acquire,
		/** Legacy immediate suspension; scoped capture uses acquire("capture") instead. */
		suspend: Effect.fn("AudioOutput.suspend")(
			function* (): Effect.fn.Return<void> {
				const previous = active;
				if (previous) yield* release(previous);
			},
		),
		close: Effect.fn("AudioOutput.close")(
			(): Effect.Effect<void> =>
				Effect.uninterruptible(
					Effect.gen(function* () {
						// Invalidate immediately, then wait for any previous native teardown.
						closed = true;
						yield* gate.withPermits(1)(
							Effect.gen(function* () {
								const previous = active;
								if (previous) yield* release(previous);
							}),
						);
					}),
				),
		),
	};
});

export class AudioOutput extends Effect.Service<AudioOutput>()(
	"@open-quake/edge/AudioOutput",
	{
		accessors: true,
		effect: makeAudioOutput,
	},
) {}
