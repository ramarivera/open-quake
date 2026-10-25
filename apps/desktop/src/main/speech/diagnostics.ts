import type { Effect, Layer } from "effect";
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
