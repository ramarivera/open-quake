import { Clock, Effect, Option } from "effect";
import { SpeechPhaseTimeout } from "./speech-errors.js";

/** AI-156, audioBotTtsWatchdog.js:17–58. Timed from received audio. */
export const playbackWatchdog = Effect.fn("Speech.playbackWatchdog")(function* (
	durationMs: number,
	context: () => Effect.Effect<string>,
	resume: () => Effect.Effect<void>,
	phase: () => "playerReady" | "playback" = () => "playback",
): Effect.fn.Return<never, SpeechPhaseTimeout> {
	const deadline = durationMs > 0 ? durationMs + 5000 : 30000;
	const started = yield* Clock.currentTimeMillis;
	yield* Effect.sleep(8000);
	// A stalled renderer probe must not disable the audio deadline.
	const state = yield* context().pipe(
		Effect.timeoutOption(Math.max(0, deadline - 8000)),
	);
	if (Option.isSome(state) && state.value !== "running") {
		// Resume can itself hang under Chromium activation rules. The new
		// deadline owns that attempt and interruption joins it on every exit.
		yield* Effect.scoped(
			Effect.gen(function* () {
				yield* resume().pipe(Effect.forkScoped);
				yield* Effect.sleep(Math.max(8000, deadline));
			}),
		);
	} else {
		const elapsed = (yield* Clock.currentTimeMillis) - started;
		yield* Effect.sleep(Math.max(0, deadline - elapsed));
	}
	return yield* new SpeechPhaseTimeout(phase());
});
