import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { SpeechOutputTarget } from "../../../../../packages/edge/src/ai/speech/speech-ports";
import {
	createHostTones,
	HOST_TONE_RESOURCES,
	hostToneResource,
} from "./host-tones";

it.effect(
	"KNOB-068: app-owned cues are bounded PCM resources, disabled until opt-in and target their device",
	() =>
		Effect.gen(function* () {
			const calls: SpeechOutputTarget[] = [];
			const played: number[] = [];
			let enabled = false,
				stopped = 0;
			const play = createHostTones(
				{
					suspendForCapture: Effect.void,
					acquire: Effect.die("must use explicit target"),
					acquireFor: (target) =>
						Effect.sync(() => {
							calls.push(target);
							return {
								ready: Effect.void,
								play: (audio) =>
									Effect.sync(() => {
										played.push(audio.durationMs);
									}),
								stop: Effect.sync(() => {
									stopped++;
								}),
							};
						}),
				},
				() => Effect.succeed(enabled),
			);
			yield* play("A", "start");
			expect(calls).toEqual([]);
			enabled = true;
			for (const tone of ["start", "end", "error", "busy"] as const) {
				const audio = hostToneResource(tone);
				expect(audio.bytes.length).toBe(
					HOST_TONE_RESOURCES[tone].durationMs * 48,
				);
				expect(audio.bytes.some((byte) => byte !== 0)).toBe(true);
				yield* play("A", tone);
			}
			expect(calls).toEqual(
				Array(4).fill({ kind: "device", serial: "A", keyCode: "0,1" }),
			);
			expect(played).toEqual([80, 100, 160, 120]);
			expect(stopped).toBe(4);
		}),
);
