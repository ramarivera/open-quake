import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { AiProviderService } from "../ai-service.js";
import { verifiedAudio } from "./speech-audio.js";
import {
	dashscopeProfile,
	fragmentedResponse,
	silentOutput,
	speechLayer,
	dashscopeSse as sse,
	streamingWav,
	ttsProfile,
	wav,
} from "./speech-test-fixtures.js";

describe("provider speech framing", () => {
	it.effect(
		"plays fragmented streaming WAV with unknown RIFF and final data lengths",
		() => {
			const bytes = streamingWav();
			let plays = 0;
			return Effect.gen(function* () {
				const turn = yield* (yield* AiProviderService).createSpeech(
					ttsProfile,
					"answer",
				);
				expect(yield* turn.result).toEqual({ _tag: "completed" });
				expect(plays).toBe(1);
			}).pipe(
				Effect.provide(
					speechLayer(
						{
							fetch: async () =>
								new Response(
									new ReadableStream<Uint8Array>({
										start(controller) {
											for (let offset = 0; offset < bytes.length; offset += 7)
												controller.enqueue(bytes.slice(offset, offset + 7));
											controller.close();
										},
									}),
									{ headers: { "Content-Type": "audio/wav" } },
								),
						},
						{
							acquire: Effect.succeed({
								ready: Effect.void,
								play: (audio) =>
									Effect.sync(() => {
										expect(audio.bytes).toEqual(bytes);
										expect(audio.durationMs).toBe(20);
										plays++;
									}),
								stop: Effect.void,
							}),
						},
					),
				),
			);
		},
	);
	it.effect(
		"accepts JSON-null progress and requires stop before completing DashScope synthesis",
		() =>
			Effect.gen(function* () {
				const audio = yield* (yield* AiProviderService).synthesize(
					dashscopeProfile,
					"answer",
				);
				expect([...audio.bytes]).toEqual([0, 1, 2, 3]);
			}).pipe(
				Effect.provide(
					speechLayer(
						{
							fetch: async () =>
								fragmentedResponse(
									sse.replace('"finish_reason":"null"', '"finish_reason":null'),
									1,
								),
						},
						silentOutput,
					),
				),
			),
	);
	it.effect(
		"rejects unsupported DashScope reasons, missing stop and frames after stop",
		() =>
			Effect.gen(function* () {
				for (const text of [
					...["length", "error", "", 0, false, {}].map((reason) =>
						sse.replace(
							'"finish_reason":"null"',
							`"finish_reason":${JSON.stringify(reason)}`,
						),
					),
					sse.replace('data: {"output":{"finish_reason":"stop"}}\n\n', ""),
					sse
						.replace('"finish_reason":"null"', '"finish_reason":null')
						.replace('data: {"output":{"finish_reason":"stop"}}\n\n', ""),
					`${sse}data: {"output":{"finish_reason":"null"}}\n\n`,
				]) {
					yield* Effect.gen(function* () {
						const result = yield* Effect.either(
							(yield* AiProviderService).synthesize(dashscopeProfile, "answer"),
						);
						expect(Either.isLeft(result) && result.left).toMatchObject({
							_tag: "AiProtocolInvalid",
							code: "AI.PROVIDER.PROTOCOL_INVALID",
						});
					}).pipe(
						Effect.provide(
							speechLayer(
								{ fetch: async () => fragmentedResponse(text, 1) },
								{ acquire: Effect.die("invalid SSE must not acquire output") },
							),
						),
					);
				}
			}),
	);
	it("accepts streaming size sentinels while rejecting malformed WAV and PCM", () => {
		for (const [riff, data] of [
			[0xffffffff, 960],
			[996, 0xffffffff],
			[0xffffffff, 0xffffffff],
		] as const) {
			const bytes = streamingWav();
			const view = new DataView(bytes.buffer);
			view.setUint32(4, riff, true);
			view.setUint32(40, data, true);
			const result = verifiedAudio(bytes, "wav");
			expect(Either.isRight(result) && result.right.durationMs).toBe(20);
		}
		for (const [offset, value] of [
			[4, 995],
			[40, 962],
			[16, 0xffffffff],
			[20, 3],
			[22, 2],
			[24, 48000],
			[28, 96000],
			[32, 4],
			[34, 8],
			[40, 0],
		] as const) {
			for (const make of [wav, streamingWav]) {
				const bytes = make();
				new DataView(bytes.buffer).setUint32(offset, value, true);
				const result = verifiedAudio(bytes, "wav");
				expect(Either.isLeft(result) && result.left._tag).toBe(
					"SpeechFormatUnsupported",
				);
			}
		}
		for (const bytes of [
			streamingWav().slice(0, -1),
			streamingWav().slice(0, 44),
		]) {
			const result = verifiedAudio(bytes, "wav");
			expect(Either.isLeft(result) && result.left._tag).toBe(
				"SpeechFormatUnsupported",
			);
		}
	});
	it("rejects nonfinal streaming data, unknown chunk sentinels and duplicate chunks", () => {
		const streaming = streamingWav();
		const nonfinal = new Uint8Array(streaming.length);
		nonfinal.set(streaming.subarray(0, 12));
		nonfinal.set(streaming.subarray(36), 12);
		nonfinal.set(streaming.subarray(12, 36), streaming.length - 24);
		const unknown = streamingWav();
		unknown.set(new TextEncoder().encode("JUNK"), 36);
		const duplicateFmt = new Uint8Array(wav().length + 24);
		duplicateFmt.set(wav());
		duplicateFmt.set(wav().subarray(12, 36), wav().length);
		new DataView(duplicateFmt.buffer).setUint32(
			4,
			duplicateFmt.length - 8,
			true,
		);
		const duplicateData = new Uint8Array(wav().length + 8);
		duplicateData.set(wav());
		duplicateData.set(new TextEncoder().encode("data"), wav().length);
		new DataView(duplicateData.buffer).setUint32(
			4,
			duplicateData.length - 8,
			true,
		);
		for (const bytes of [nonfinal, unknown, duplicateFmt, duplicateData]) {
			const result = verifiedAudio(bytes, "wav");
			expect(Either.isLeft(result) && result.left._tag).toBe(
				"SpeechFormatUnsupported",
			);
		}
	});
});
