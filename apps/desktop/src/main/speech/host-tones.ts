import { Effect } from "effect";
import {
	type GeneratedAudio,
	PCM_24K,
} from "../../../../../packages/edge/src/ai/speech/speech-contracts";
import type { SpeechOutput } from "../../../../../packages/edge/src/ai/speech/speech-ports";
import type { VoiceTone } from "../../shared/voice-surface";

/** App-owned PCM cues. No proprietary resources or executable asset paths. */
export const HOST_TONE_RESOURCES = {
	start: { frequency: 660, durationMs: 80 },
	end: { frequency: 440, durationMs: 100 },
	error: { frequency: 220, durationMs: 160 },
	busy: { frequency: 330, durationMs: 120 },
} as const;
export function hostToneResource(tone: VoiceTone): GeneratedAudio {
	const { frequency, durationMs } = HOST_TONE_RESOURCES[tone];
	const samples = durationMs * 24;
	const bytes = new Uint8Array(samples * 2);
	const view = new DataView(bytes.buffer);
	for (let i = 0; i < samples; i++) {
		const envelope = Math.min(1, i / 120, (samples - i) / 120);
		view.setInt16(
			i * 2,
			Math.round(
				Math.sin((2 * Math.PI * frequency * i) / 24000) * envelope * 4000,
			),
			true,
		);
	}
	return {
		bytes,
		format: "pcm",
		descriptor: PCM_24K,
		durationMs,
		provenance: "generation",
	};
}
/** Disabled by default. Capture and existing output ownership always take priority. */
export function createHostTones(
	output: typeof SpeechOutput.Service,
	enabled: () => Effect.Effect<boolean>,
) {
	return Effect.fn("DesktopSpeech.hostTone")(function* (
		serial: string,
		tone: VoiceTone,
	) {
		if (!(yield* enabled())) return;
		yield* Effect.scoped(
			Effect.gen(function* () {
				const target = { kind: "device", serial, keyCode: "0,1" } as const;
				const lease = yield* Effect.acquireRelease(
					output.acquireFor?.(target) ?? output.acquire,
					(lease) => lease.stop,
				);
				yield* lease.ready;
				yield* lease.play(hostToneResource(tone));
			}),
		).pipe(
			Effect.timeout("2 seconds"),
			Effect.catchAll((error) =>
				Effect.logWarning("Host voice tone unavailable", {
					code: "code" in error ? error.code : "VOICE.TONE.TIMEOUT",
				}),
			),
		);
	});
}
