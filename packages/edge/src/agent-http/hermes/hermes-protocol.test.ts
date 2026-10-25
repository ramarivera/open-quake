import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { decodeHermesFrame } from "./hermes-protocol.js";

it.effect(
	"ignores unknown extension events without turning them into answer text",
	() =>
		Effect.gen(function* () {
			expect(
				yield* decodeHermesFrame(
					{
						event: "hermes.future_extension",
						data: "non-json extension encoding",
					},
					{ finished: false, done: false },
				),
			).toEqual([]);
			expect(
				yield* decodeHermesFrame(
					{ event: "hermes.future_extension", data: "[DONE]" },
					{ finished: true, done: false },
				),
			).toEqual([]);
		}),
);

it.effect(
	"retains backend failure privately and exposes a scrubbed catalog error",
	() =>
		Effect.gen(function* () {
			const raw = {
				object: "chat.completion.chunk",
				choices: [{ index: 0, delta: {}, finish_reason: "error" }],
				error: { message: "private-provider-secret" },
			};
			const result = yield* decodeHermesFrame(
				{ event: "message", data: JSON.stringify(raw) },
				{ finished: false, done: false },
			).pipe(Effect.either);
			expect(result._tag).toBe("Left");
			if (result._tag === "Left") {
				expect(result.left.code).toBe("AGENT.HTTP.REQUEST.FAILED");
				expect(result.left.originalCause).toEqual(raw);
				expect(JSON.stringify(result.left)).not.toContain(
					"private-provider-secret",
				);
				expect(Object.keys(result.left)).not.toContain("originalCause");
			}
		}),
);

it.effect("rejects invalid usage counts and malformed real tool progress", () =>
	Effect.gen(function* () {
		for (const frame of [
			{
				event: "message",
				data: JSON.stringify({
					object: "chat.completion.chunk",
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: { prompt_tokens: -1, completion_tokens: 4 },
				}),
			},
			{
				event: "hermes.tool.progress",
				data: JSON.stringify({ tool: "read_file", status: "completed" }),
			},
		]) {
			const result = yield* decodeHermesFrame(frame, {
				finished: false,
				done: false,
			}).pipe(Effect.either);
			expect(result._tag === "Left" && result.left.code).toBe(
				"AGENT.HTTP.PROTOCOL.INVALID",
			);
		}
	}),
);
