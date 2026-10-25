import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Layer, Queue, Redacted, TestClock } from "effect";
import { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import {
	SpeechHttp,
	SpeechOutput,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { AiSpeechService } from "../../../../../packages/edge/src/ai/speech/speech-service";
import {
	ttsProfile,
	wav,
} from "../../../../../packages/edge/src/ai/speech/speech-test-fixtures";
import { createOrderedSpeech } from "./ordered";

const speechLayer = (
	texts: string[],
	play: Effect.Effect<void> = Effect.void,
) =>
	AiSpeechService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(AiCredentials, {
					resolve: () => Effect.succeed(Redacted.make("fixture")),
					revoked: () => Effect.never,
				}),
				Layer.succeed(SpeechHttp, {
					fetch: async (_url, init) => {
						const input = JSON.parse(String(init.body)) as { input: string };
						texts.push(input.input);
						return new Response(wav(), {
							headers: { "Content-Type": "audio/wav" },
						});
					},
				}),
				Layer.succeed(SpeechOutput, {
					suspendForCapture: Effect.void,
					acquire: Effect.succeed({
						ready: Effect.void,
						play: () => play,
						stop: Effect.void,
					}),
				}),
			),
		),
	);
describe("bounded ordered answer speech", () => {
	it.effect(
		"flushes at 200 characters and two seconds using the real synthesis consumer",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const texts: string[] = [];
					yield* Effect.gen(function* () {
						const ordered = yield* createOrderedSpeech({
							speech: yield* AiSpeechService,
							profile: ttsProfile,
							report: () => Effect.die("unexpected speech error"),
						});
						yield* ordered.push("x".repeat(200));
						yield* ordered.settled;
						expect(texts).toEqual(["x".repeat(200)]);
						yield* ordered.push("tail");
						yield* TestClock.adjust(1999);
						expect(texts).toHaveLength(1);
						yield* TestClock.adjust(1);
						yield* ordered.settled;
						expect(texts).toEqual(["x".repeat(200), "tail"]);
						yield* ordered.cancel();
					}).pipe(Effect.provide(speechLayer(texts)));
				}),
			),
	);
	it.effect(
		"overflows at 4000 characters, cancels the remainder, and keeps later answer text silent",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const texts: string[] = [],
						codes: string[] = [];
					const playing = yield* Deferred.make<void>();
					yield* Effect.gen(function* () {
						const ordered = yield* createOrderedSpeech({
							speech: yield* AiSpeechService,
							profile: ttsProfile,
							report: (error) => Effect.sync(() => codes.push(error.code)),
						});
						yield* ordered.push("x".repeat(4000));
						yield* Deferred.await(playing);
						yield* ordered.push("overflow");
						yield* ordered.push("still readable in chat");
						expect(codes).toEqual(["VOICE.TTS.QUEUE_FULL"]);
						expect(texts).toHaveLength(1);
					}).pipe(
						Effect.provide(
							speechLayer(
								texts,
								Deferred.succeed(playing, undefined).pipe(
									Effect.zipRight(Effect.never),
								),
							),
						),
					);
				}),
			),
	);
	it.effect(
		"cancels active synthesis physically and drops late provider audio",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					let aborted = false,
						played = 0;
					const calls = yield* Queue.unbounded<void>();
					const http: typeof SpeechHttp.Service = {
						fetch: async (_url, init) => {
							await Effect.runPromise(Queue.offer(calls, undefined));
							return new Promise<Response>((_resolve, reject) =>
								init.signal?.addEventListener(
									"abort",
									() => {
										aborted = true;
										reject(new Error("synthetic abort"));
									},
									{ once: true },
								),
							);
						},
					};
					const layer = AiSpeechService.Default.pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(AiCredentials, {
									resolve: () => Effect.succeed(Redacted.make("fixture")),
									revoked: () => Effect.never,
								}),
								Layer.succeed(SpeechHttp, http),
								Layer.succeed(SpeechOutput, {
									suspendForCapture: Effect.void,
									acquire: Effect.succeed({
										ready: Effect.void,
										play: () =>
											Effect.sync(() => {
												played++;
											}),
										stop: Effect.void,
									}),
								}),
							),
						),
					);
					yield* Effect.gen(function* () {
						const ordered = yield* createOrderedSpeech({
							speech: yield* AiSpeechService,
							profile: ttsProfile,
							report: () => Effect.void,
						});
						yield* ordered.push("Cancel.");
						yield* Queue.take(calls);
						yield* ordered.cancel();
						expect(aborted).toBe(true);
						expect(played).toBe(0);
					}).pipe(Effect.provide(layer));
				}),
			),
	);
});
