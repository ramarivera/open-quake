import { Effect, type Layer } from "effect";
import type { SpeechOutcome } from "../../../../../packages/edge/src/ai/speech/speech-service";
/** Structural Pick<DesktopDiagnostics, 'layer' | 'instrument'>, independent of the optional diagnostics lane. */
export interface SpeechDiagnostics {
	readonly layer: Layer.Layer<never>;
	readonly instrument: <A, E, R>(
		effect: Effect.Effect<A, E, R>,
		operation:
			| "speech.capture"
			| "speech.recognize"
			| "speech.synthesize"
			| "speech.playback"
			| "speech.shutdown",
	) => Effect.Effect<A, E, R>;
}

/** TTS returns a textOnly value. Lift that error while tracing, then restore the public outcome. */
export function instrumentSpeechOutcome(
	effect: Effect.Effect<SpeechOutcome>,
	instrument: SpeechDiagnostics["instrument"] | undefined,
): Effect.Effect<SpeechOutcome> {
	if (!instrument) return effect;
	return instrument(
		effect.pipe(
			Effect.flatMap((outcome) =>
				outcome._tag === "textOnly"
					? Effect.fail(outcome.error)
					: Effect.succeed(outcome),
			),
		),
		"speech.playback",
	).pipe(
		Effect.catchAll((error) =>
			Effect.succeed({ _tag: "textOnly" as const, error }),
		),
	);
}
