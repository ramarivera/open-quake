import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Either,
	Fiber,
	Option,
	Redacted,
	TestClock,
} from "effect";
import * as fc from "fast-check";
import { AiAuthRevoked } from "../ai-errors.js";
import { AiProviderService } from "../ai-service.js";
import { verifiedAudio } from "./speech-audio.js";
import { OPENAI_TTS_SHUTDOWN, speechInstructions } from "./speech-contracts.js";
import { SpeechFormatUnsupported } from "./speech-errors.js";
import {
	dashscopeProfile,
	fragmentedResponse,
	silentOutput,
	speechLayer,
	ttsProfile,
	wav,
} from "./speech-test-fixtures.js";

const sse =
	'data: {"output":{\n' +
	'data: "audio":{"data":"AAECAw=="}}}\n\n' +
	'data: {"output":{"finish_reason":"stop"}}\n\n';

describe("speech through the provider facade and player", () => {
	it.effect(
		"sends independent OpenAI WAV synthesis and waits for natural player drain",
		() =>
			Effect.gen(function* () {
				const drained = yield* Deferred.make<void>();
				const playing = yield* Deferred.make<void>();
				let stopped = 0;
				const requests: { url: string; init: RequestInit }[] = [];
				const layer = speechLayer(
					{
						fetch: async (url, init) => {
							requests.push({ url, init });
							return new Response(wav(), {
								headers: { "Content-Type": "audio/wav" },
							});
						},
					},
					{
						acquire: Effect.succeed({
							ready: Effect.void,
							play: (audio) =>
								Effect.gen(function* () {
									expect(audio.provenance).toBe("generation");
									expect(audio.durationMs).toBe(20);
									yield* Deferred.succeed(playing, undefined);
									yield* Deferred.await(drained);
								}),
							stop: Effect.sync(() => {
								stopped++;
							}),
						}),
					},
				);
				yield* Effect.gen(function* () {
					const turn = yield* (yield* AiProviderService).createSpeech(
						ttsProfile,
						"readable answer",
					);
					const consumer = yield* turn.result.pipe(Effect.fork);
					yield* Deferred.await(playing);
					expect(Fiber.isFiber(consumer)).toBe(true);
					expect(requests).toHaveLength(1);
					expect(requests[0]?.url).toBe(
						"https://api.openai.com/v1/audio/speech",
					);
					expect(requests[0]?.init.redirect).toBe("error");
					expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
						model: "gpt-4o-mini-tts",
						voice: "marin",
						input: "readable answer",
						instructions: speechInstructions("de"),
						response_format: "wav",
					});
					expect(Option.isNone(yield* Fiber.poll(consumer))).toBe(true);
					yield* Deferred.succeed(drained, undefined);
					expect(yield* Fiber.join(consumer)).toEqual({ _tag: "completed" });
					expect(stopped).toBe(1);
				}).pipe(Effect.provide(layer));
			}),
	);
	it.effect(
		"parses fragmented multiline SSE and preserves exact PCM order",
		() =>
			Effect.gen(function* () {
				let played: Uint8Array | undefined;
				let body = "";
				const layer = speechLayer(
					{
						fetch: async (_url, init) => {
							body = String(init.body);
							return fragmentedResponse(sse, 1);
						},
					},
					{
						acquire: Effect.succeed({
							ready: Effect.void,
							play: (audio) =>
								Effect.sync(() => {
									played = audio.bytes;
								}),
							stop: Effect.void,
						}),
					},
				);
				yield* Effect.gen(function* () {
					const turn = yield* (yield* AiProviderService).createSpeech(
						dashscopeProfile,
						"answer",
					);
					expect(yield* turn.result).toEqual({ _tag: "completed" });
					expect([...(played ?? [])]).toEqual([0, 1, 2, 3]);
					expect(JSON.parse(body)).toEqual({
						model: "qwen-audio-3.1-tts-flash",
						input: {
							text: "answer",
							voice: "longanlingxin_v3.1",
							format: "pcm",
							sample_rate: 24000,
						},
					});
				}).pipe(Effect.provide(layer));
			}),
	);
	it.effect(
		"rejects truncated/error SSE and unknown formats without playing or fallback",
		() =>
			Effect.gen(function* () {
				for (const response of [
					() =>
						fragmentedResponse(
							'data: {"output":{"audio":{"data":"AAE="}}}\n\n',
						),
					() =>
						fragmentedResponse(
							'data: {"output":{"finish_reason":"error"},"code":"bad"}\n\n',
						),
					() =>
						fragmentedResponse('data: {"output":{"audio":{"data":"@@@"}}}\n\n'),
					() =>
						new Response("not-audio", {
							headers: { "Content-Type": "text/html" },
						}),
				]) {
					let calls = 0;
					yield* Effect.gen(function* () {
						const turn = yield* (yield* AiProviderService).createSpeech(
							dashscopeProfile,
							"text stays available",
						);
						const result = yield* turn.result;
						expect(result._tag).toBe("textOnly");
						expect(calls).toBe(1);
					}).pipe(
						Effect.provide(
							speechLayer(
								{
									fetch: async () => {
										calls++;
										return response();
									},
								},
								{ acquire: Effect.die("bad audio must not acquire output") },
							),
						),
					);
				}
			}),
	);
	it.effect(
		"keeps exact catalog error and private safe cause for a rate limit",
		() => {
			const original = new Response("private provider content", {
				status: 429,
			});
			return Effect.gen(function* () {
				const turn = yield* (yield* AiProviderService).createSpeech(
					ttsProfile,
					"answer",
				);
				const result = yield* turn.result;
				expect(result._tag).toBe("textOnly");
				if (result._tag === "textOnly") {
					expect(result.error.code).toBe("AI.PROVIDER.RATE_LIMITED");
					expect(
						"originalCause" in result.error && result.error.originalCause,
					).toBe(original);
					expect(JSON.stringify(result.error)).not.toContain(
						"private provider content",
					);
				}
			}).pipe(
				Effect.provide(
					speechLayer({ fetch: async () => original }, silentOutput),
				),
			);
		},
	);

	it.effect(
		"disables retired OpenAI models and rejects replacement transports before HTTP",
		() =>
			Effect.gen(function* () {
				yield* TestClock.setTime(OPENAI_TTS_SHUTDOWN);
				const service = yield* AiProviderService;
				for (const profile of [
					ttsProfile,
					{ ...ttsProfile, model: "gpt-realtime" },
					{ ...ttsProfile, voice: "unknown" },
				]) {
					const result = yield* Effect.either(
						service.synthesize(profile, "answer"),
					);
					expect(Either.isLeft(result) && result.left.code).toBe(
						"AI.PROVIDER.UNAVAILABLE",
					);
				}
			}).pipe(
				Effect.provide(
					speechLayer(
						{ fetch: () => Promise.reject(new Error("must not fetch")) },
						silentOutput,
					),
				),
			),
	);
	it.effect("cancel before dispatch prevents HTTP and output acquisition", () =>
		Effect.gen(function* () {
			const turn = yield* (yield* AiProviderService).createSpeech(
				ttsProfile,
				"answer",
			);
			yield* turn.cancel();
			expect(yield* turn.result).toEqual({ _tag: "cancelled" });
		}).pipe(
			Effect.provide(
				speechLayer(
					{ fetch: () => Promise.reject(new Error("must not fetch")) },
					{ acquire: Effect.die("must not acquire") },
				),
			),
		),
	);
	it.effect(
		"cancels HTTP, ignores late audio and never reports completion",
		() =>
			Effect.gen(function* () {
				const called = yield* Deferred.make<void>();
				let resolveResponse: (value: Response) => void = () => undefined;
				let signal: AbortSignal | undefined;
				const pending = new Promise<Response>((resolve) => {
					resolveResponse = resolve;
				});
				const layer = speechLayer(
					{
						fetch: (_url, init) => {
							signal = init.signal ?? undefined;
							return pending;
						},
					},
					{ acquire: Effect.die("cancelled audio must not play") },
				);
				yield* Effect.gen(function* () {
					const turn = yield* (yield* AiProviderService).createSpeech(
						ttsProfile,
						"answer",
					);
					const fiber = yield* turn.result.pipe(
						Effect.tap(() => Deferred.succeed(called, undefined)),
						Effect.fork,
					);
					yield* TestClock.adjust(1);
					yield* turn.cancel();
					expect(yield* Fiber.join(fiber)).toEqual({ _tag: "cancelled" });
					expect(signal?.aborted).toBe(true);
					resolveResponse(
						new Response(wav(), { headers: { "Content-Type": "audio/wav" } }),
					);
				}).pipe(Effect.provide(layer));
			}),
	);
	it.effect("stops owned playback on cancel and releases it exactly once", () =>
		Effect.gen(function* () {
			const playing = yield* Deferred.make<void>();
			let stopped = 0;
			const layer = speechLayer(
				{
					fetch: async () =>
						new Response(wav(), { headers: { "Content-Type": "audio/wav" } }),
				},
				{
					acquire: Effect.succeed({
						ready: Effect.void,
						play: () =>
							Deferred.succeed(playing, undefined).pipe(
								Effect.zipRight(Effect.never),
							),
						stop: Effect.sync(() => {
							stopped++;
						}),
					}),
				},
			);
			yield* Effect.gen(function* () {
				const turn = yield* (yield* AiProviderService).createSpeech(
					ttsProfile,
					"answer",
				);
				const fiber = yield* turn.result.pipe(Effect.fork);
				yield* Deferred.await(playing);
				yield* turn.cancel();
				expect(yield* Fiber.join(fiber)).toEqual({ _tag: "cancelled" });
				expect(stopped).toBe(1);
			}).pipe(Effect.provide(layer));
		}),
	);
	it.effect("bounds synthesis at 30 seconds and aborts the request", () =>
		Effect.gen(function* () {
			let signal: AbortSignal | undefined;
			const layer = speechLayer(
				{
					fetch: (_url, init) => {
						signal = init.signal ?? undefined;
						return new Promise(() => undefined);
					},
				},
				silentOutput,
			);
			yield* Effect.gen(function* () {
				const turn = yield* (yield* AiProviderService).createSpeech(
					ttsProfile,
					"answer",
				);
				const fiber = yield* turn.result.pipe(Effect.fork);
				yield* TestClock.adjust(30000);
				const result = yield* Fiber.join(fiber);
				expect(result._tag === "textOnly" && result.error.code).toBe(
					"VOICE.CAPTURE.PHASE_TIMEOUT",
				);
				expect(signal?.aborted).toBe(true);
			}).pipe(Effect.provide(layer));
		}),
	);
	it.effect(
		"bounds readiness and playback separately and stops stalled output",
		() =>
			Effect.gen(function* () {
				for (const phase of ["playerReady", "playback"] as const) {
					let stopped = 0;
					const layer = speechLayer(
						{
							fetch: async () =>
								new Response(wav(), {
									headers: { "Content-Type": "audio/wav" },
								}),
						},
						{
							acquire: Effect.succeed({
								ready: phase === "playerReady" ? Effect.never : Effect.void,
								play: () => Effect.never,
								stop: Effect.sync(() => {
									stopped++;
								}),
							}),
						},
					);
					yield* Effect.gen(function* () {
						const turn = yield* (yield* AiProviderService).createSpeech(
							ttsProfile,
							"answer",
						);
						const fiber = yield* turn.result.pipe(Effect.fork);
						yield* TestClock.adjust(11000);
						const result = yield* Fiber.join(fiber);
						expect(
							result._tag === "textOnly" &&
								"phase" in result.error &&
								result.error.phase,
						).toBe(phase);
						expect(stopped).toBe(1);
					}).pipe(Effect.provide(layer));
				}
			}),
	);
	it.effect(
		"credential revocation interrupts playback without switching provider",
		() =>
			Effect.gen(function* () {
				const revoke = yield* Deferred.make<never, AiAuthRevoked>();
				const playing = yield* Deferred.make<void>();
				let stopped = 0;
				const layer = speechLayer(
					{
						fetch: async () =>
							new Response(wav(), { headers: { "Content-Type": "audio/wav" } }),
					},
					{
						acquire: Effect.succeed({
							ready: Effect.void,
							play: () =>
								Deferred.succeed(playing, undefined).pipe(
									Effect.zipRight(Effect.never),
								),
							stop: Effect.sync(() => {
								stopped++;
							}),
						}),
					},
					{
						resolve: () => Effect.succeed(Redacted.make("fixture-key")),
						revoked: () => Deferred.await(revoke),
					},
				);
				yield* Effect.gen(function* () {
					const turn = yield* (yield* AiProviderService).createSpeech(
						ttsProfile,
						"answer",
					);
					const fiber = yield* turn.result.pipe(Effect.fork);
					yield* Deferred.await(playing);
					yield* Deferred.fail(revoke, new AiAuthRevoked());
					const result = yield* Fiber.join(fiber);
					expect(result._tag === "textOnly" && result.error.code).toBe(
						"AI.PROVIDER.AUTH_REVOKED",
					);
					expect(stopped).toBe(1);
				}).pipe(Effect.provide(layer));
			}),
	);
	it.effect(
		"bounds output acquisition and serializes concurrent utterances",
		() =>
			Effect.gen(function* () {
				const stalled = speechLayer(
					{
						fetch: async () =>
							new Response(wav(), { headers: { "Content-Type": "audio/wav" } }),
					},
					{ acquire: Effect.never },
				);
				yield* Effect.gen(function* () {
					const turn = yield* (yield* AiProviderService).createSpeech(
						ttsProfile,
						"answer",
					);
					const fiber = yield* turn.result.pipe(Effect.fork);
					yield* TestClock.adjust(10000);
					const result = yield* Fiber.join(fiber);
					expect(
						result._tag === "textOnly" &&
							"phase" in result.error &&
							result.error.phase,
					).toBe("playerReady");
				}).pipe(Effect.provide(stalled));
				const playing = yield* Deferred.make<void>();
				const drain = yield* Deferred.make<void>();
				let active = 0;
				let maximum = 0;
				let calls = 0;
				const ordered = speechLayer(
					{
						fetch: async () => {
							calls++;
							return new Response(wav(), {
								headers: { "Content-Type": "audio/wav" },
							});
						},
					},
					{
						acquire: Effect.sync(() => {
							active++;
							maximum = Math.max(maximum, active);
							return {
								ready: Effect.void,
								play: () =>
									Deferred.succeed(playing, undefined).pipe(
										Effect.zipRight(Deferred.await(drain)),
									),
								stop: Effect.sync(() => {
									active--;
								}),
							};
						}),
					},
				);
				yield* Effect.gen(function* () {
					const service = yield* AiProviderService;
					const first = yield* service.createSpeech(ttsProfile, "one");
					const second = yield* service.createSpeech(ttsProfile, "two");
					const one = yield* first.result.pipe(Effect.fork);
					yield* Deferred.await(playing);
					const two = yield* second.result.pipe(Effect.fork);
					yield* TestClock.adjust(1);
					expect(calls).toBe(1);
					yield* Deferred.succeed(drain, undefined);
					expect((yield* Fiber.join(one))._tag).toBe("completed");
					expect((yield* Fiber.join(two))._tag).toBe("completed");
					expect(maximum).toBe(1);
					expect(active).toBe(0);
				}).pipe(Effect.provide(ordered));
			}),
	);

	it("validates WAV and rejects arbitrary or mismatched headers", () => {
		expect(Either.isRight(verifiedAudio(wav(), "wav"))).toBe(true);
		const bytes = wav();
		new DataView(bytes.buffer).setUint32(24, 48000, true);
		const failure = verifiedAudio(bytes, "wav");
		expect(Either.isLeft(failure) && failure.left).toBeInstanceOf(
			SpeechFormatUnsupported,
		);
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 43 }), (data) => {
				expect(Either.isLeft(verifiedAudio(data, "wav"))).toBe(true);
			}),
		);
	});
});
