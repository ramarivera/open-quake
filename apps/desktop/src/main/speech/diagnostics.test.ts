import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { AiAuthRequired } from "../../../../../packages/edge/src/ai/ai-errors";
import { instrumentSpeechOutcome } from "./diagnostics";
import { DesktopSpeechError } from "./errors";

describe("speech diagnostic error boundaries", () => {
	it("reports typed synthesis failure before restoring text-only continuation", async () => {
		const error = new AiAuthRequired(
			new Error("private provider key and generated text"),
		);
		const captured: unknown[] = [];
		const outcome = await Effect.runPromise(
			instrumentSpeechOutcome(
				Effect.succeed({ _tag: "textOnly" as const, error }),
				(effect, operation) =>
					effect.pipe(
						Effect.tapError((failure) =>
							Effect.sync(() => {
								captured.push({ operation, failure });
							}),
						),
					),
			),
		);
		expect(outcome).toEqual({ _tag: "textOnly", error });
		expect(captured).toEqual([
			{ operation: "speech.playback", failure: error },
		]);
	});
	it("keeps host causes private and uses catalog identities without PCM or text in JSON", () => {
		const cause = new Error("secret-key transcript raw-pcm");
		const error = new DesktopSpeechError(
			"RecorderUnavailable",
			"recorder",
			cause,
		);
		expect(error.originalCause).toBe(cause);
		expect(JSON.stringify(error)).not.toMatch(/secret-key|transcript|raw-pcm/);
		expect(JSON.parse(JSON.stringify(error))).toMatchObject({
			_tag: "DesktopSpeechError",
			code: "VOICE.CAPTURE.RECORDER_UNAVAILABLE",
			diagnosticCause: { name: "Error", truncated: true },
		});
	});
});
