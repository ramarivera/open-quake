import { createHmac } from "node:crypto";
import { describe, expect, it } from "@effect/vitest";
import {
	Chunk,
	Deferred,
	Effect,
	Fiber,
	Redacted,
	Stream,
	TestClock,
} from "effect";
import type { InferenceRequest, ProviderProfile } from "../ai-contracts.js";
import { AiRepository } from "../ai-repository.js";
import { AiProviderService } from "../ai-service.js";
import {
	workflowLayer,
	workflowProfile,
	workflowRequest,
} from "../ai-test-fixtures.js";
import { makeProviderAdapter } from "./provider-adapter.js";
import { makeSparkAdapter, sparkSignedUrl } from "./xfy.js";

const credentials = {
	appId: "app-fixture",
	apiKey: "spark-key-fixture",
	apiSecret: "spark-secret-fixture",
};
const cozeProfile: ProviderProfile = {
	...workflowProfile,
	adapter: "coze",
	provider: "coze",
	baseUrl: "https://api.coze.cn",
	models: {},
	settings: { botId: "bot-fixture" },
};
const sparkProfile: ProviderProfile = {
	...workflowProfile,
	adapter: "xfy",
	provider: "xfy",
	baseUrl: "https://spark-api.xf-yun.com",
	models: {},
	modelId: "spark-pro",
};
const packet = (event: string, data: unknown) =>
	`event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
const cozeResponse = () =>
	new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				const bytes = new TextEncoder().encode(
					packet("conversation.message.delta", {
						type: "answer",
						content: "你好",
					}) +
						packet("conversation.message.completed", {
							type: "follow_up",
							content: "Next?",
						}) +
						packet("conversation.chat.completed", {
							status: "completed",
							usage: { input_count: 3, output_count: 2 },
						}),
				);
				for (let i = 0; i < bytes.length; i += 7)
					controller.enqueue(bytes.slice(i, i + 7));
				controller.close();
			},
		}),
		{ headers: { "content-type": "text/event-stream" } },
	);
const frame = (status: number, content: string, code = 0) =>
	JSON.stringify({
		header: { code, status },
		payload: {
			choices: { status, text: [{ content }] },
			usage: { text: { prompt_tokens: 3, completion_tokens: 2 } },
		},
	});
const input = (
	profile: ProviderProfile,
	request: InferenceRequest = workflowRequest,
) => ({
	profile,
	request,
	providerOptions: {},
	credential: Redacted.make(JSON.stringify(credentials)),
	signal: new AbortController().signal,
	redirectPolicy: "error" as const,
	maxRetries: 0 as const,
});

describe("Coze independent wire fixtures", () => {
	it.effect(
		"AI-001/007/034/052 uses bot messages, selected key and fragmented UTF-8 SSE through the facade",
		() => {
			const calls: { url: string; init?: RequestInit }[] = [];
			const adapter = makeProviderAdapter(async (url, init) => {
				calls.push({ url: String(url), ...(init ? { init } : {}) });
				return cozeResponse();
			});
			return Effect.gen(function* () {
				yield* AiRepository.put(cozeProfile);
				const generation = yield* AiProviderService.generate(workflowRequest);
				const events = Chunk.toReadonlyArray(
					yield* Stream.runCollect(generation.events),
				);
				expect(events).toMatchObject([
					{ _tag: "textDelta", textDelta: "你好" },
					{ _tag: "suggestion", text: "Next?" },
					{ _tag: "usage", usage: { inputTokens: 3, outputTokens: 2 } },
					{ _tag: "completed" },
				]);
				expect(calls).toHaveLength(1);
				expect(calls[0]?.url).toBe("https://api.coze.cn/v3/chat");
				expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
					"Bearer fixture-key",
				);
				expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
					bot_id: "bot-fixture",
					stream: true,
					auto_save_history: false,
					additional_messages: [
						{
							role: "user",
							type: "question",
							content_type: "text",
							content: "hello",
						},
					],
				});
				expect(calls[0]?.init?.redirect).toBe("error");
			}).pipe(Effect.provide(workflowLayer(adapter)));
		},
	);
	for (const [status, code] of [
		[401, "AI.PROVIDER.AUTH_REQUIRED"],
		[429, "AI.PROVIDER.RATE_LIMITED"],
		[503, "AI.PROVIDER.UNAVAILABLE"],
	] as const)
		it.effect(`Coze HTTP ${status} remains typed without retry`, () => {
			let calls = 0;
			return Effect.gen(function* () {
				yield* AiRepository.put(cozeProfile);
				const generation = yield* AiProviderService.generate(workflowRequest);
				expect(
					yield* Effect.either(Stream.runDrain(generation.events)),
				).toMatchObject({ _tag: "Left", left: { code } });
				expect(calls).toBe(1);
			}).pipe(
				Effect.provide(
					workflowLayer(
						makeProviderAdapter(async () => {
							calls++;
							return new Response("private", { status });
						}),
					),
				),
			);
		});
	it.effect(
		"Coze cancellation aborts the pending body read before returning its iterator",
		() => {
			let aborted = false;
			const entered = Effect.runSync(Deferred.make<void>());
			const adapter = makeProviderAdapter(
				async (_url, init) =>
					new Response(
						new ReadableStream({
							start(controller) {
								Effect.runSync(Deferred.succeed(entered, undefined));
								init?.signal?.addEventListener("abort", () => {
									aborted = true;
									controller.error(new Error("aborted"));
								});
							},
						}),
					),
			);
			return Effect.gen(function* () {
				yield* AiRepository.put(cozeProfile);
				const generation = yield* AiProviderService.generate(workflowRequest);
				const fiber = yield* Effect.fork(Stream.runDrain(generation.events));
				yield* Deferred.await(entered);
				yield* generation.cancel();
				yield* Fiber.join(fiber);
				expect(aborted).toBe(true);
			}).pipe(Effect.provide(workflowLayer(adapter)));
		},
	);
	it.effect(
		"Coze refuses missing terminal and error/requires-action frames",
		() =>
			Effect.gen(function* () {
				for (const body of [
					packet("conversation.message.delta", {
						type: "answer",
						content: "partial",
					}),
					packet("conversation.chat.requires_action", {}),
					packet("error", { code: 400 }),
				]) {
					yield* Effect.gen(function* () {
						yield* AiRepository.put(cozeProfile);
						const generation =
							yield* AiProviderService.generate(workflowRequest);
						expect(
							yield* Effect.either(Stream.runDrain(generation.events)),
						).toMatchObject({
							_tag: "Left",
							left: { code: "AI.PROVIDER.PROTOCOL_INVALID" },
						});
					}).pipe(
						Effect.provide(
							workflowLayer(
								makeProviderAdapter(async () => new Response(body)),
							),
						),
					);
				}
			}),
	);
});

describe("Spark independent signed WebSocket fixtures", () => {
	it.effect("AI-036 signature matches independent HMAC implementation", () =>
		Effect.gen(function* () {
			const date = "Mon, 26 Oct 2026 12:00:00 GMT";
			const url = new URL(
				yield* Effect.promise(() =>
					sparkSignedUrl("/v3.1/chat", credentials, date),
				),
			);
			const signature = createHmac("sha256", credentials.apiSecret)
				.update(
					`host: spark-api.xf-yun.com\ndate: ${date}\nGET /v3.1/chat HTTP/1.1`,
				)
				.digest("base64");
			expect(atob(url.searchParams.get("authorization") ?? "")).toBe(
				`api_key="spark-key-fixture", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`,
			);
			expect(url.searchParams.get("date")).toBe(date);
		}),
	);
	for (const [modelId, path, domain] of [
		["spark3.5", "/v3.5/chat", "generalv3.5"],
		["spark3.5-max", "/v3.5/chat", "generalv3.5"],
		["spark-pro", "/v3.1/chat", "generalv3"],
		["spark4-ultra", "/v4.0/chat", "4.0Ultra"],
	] as const)
		it.effect(
			`Spark ${modelId} sends exact domain and closes owned socket`,
			() => {
				let url = "";
				let sent = "";
				let closed = 0;
				const adapter = makeSparkAdapter(async (next) => {
					url = next;
					return {
						send: async (value) => {
							sent = value;
						},
						close: () => {
							closed++;
						},
						frames: {
							async *[Symbol.asyncIterator]() {
								yield frame(0, "first");
								yield frame(2, "last");
								yield "late garbage";
							},
						},
					};
				});
				return Effect.gen(function* () {
					const events = Chunk.toReadonlyArray(
						yield* Stream.runCollect(
							yield* adapter.open(input({ ...sparkProfile, modelId })),
						),
					);
					expect(events.filter((e) => e._tag === "textDelta")).toHaveLength(2);
					expect(new URL(url).pathname).toBe(path);
					expect(JSON.parse(sent)).toMatchObject({
						header: { app_id: "app-fixture", uid: "open-quake" },
						parameter: { chat: { domain, max_tokens: 4096 } },
						payload: {
							message: { text: [{ role: "user", content: "hello" }] },
						},
					});
					expect(closed).toBeGreaterThan(0);
				});
			},
		);
	it.effect("AI-037 Spark tools reject before signing/connecting", () => {
		let calls = 0;
		const adapter = makeSparkAdapter(async () => {
			calls++;
			throw new Error("must not connect");
		});
		return Effect.gen(function* () {
			expect(
				yield* Effect.either(
					adapter.open(
						input(sparkProfile, {
							...workflowRequest,
							requestedCapabilities: ["tools"],
						}),
					),
				),
			).toMatchObject({
				_tag: "Left",
				left: { code: "AI.PROVIDER.CAPABILITY_UNSUPPORTED" },
			});
			expect(calls).toBe(0);
		});
	});
	it.effect(
		"Spark 60 second timeout interrupts stalled acquisition and closes a late socket",
		() =>
			Effect.gen(function* () {
				let late:
					| ((socket: {
							send: () => Promise<void>;
							frames: AsyncIterable<string>;
							close: () => void;
					  }) => void)
					| undefined;
				let closed = false;
				const entered = yield* Deferred.make<void>();
				const adapter = makeSparkAdapter((_url, signal) => {
					Effect.runSync(Deferred.succeed(entered, undefined));
					return new Promise((resolve) => {
						late = resolve;
						signal.addEventListener("abort", () => {});
					});
				});
				const stream = yield* adapter.open(input(sparkProfile));
				const fiber = yield* Effect.fork(
					Effect.either(Stream.runDrain(stream)),
				);
				yield* Deferred.await(entered);
				yield* TestClock.adjust("60 seconds");
				expect(yield* Fiber.join(fiber)).toMatchObject({
					_tag: "Left",
					left: { code: "AI.PROVIDER.UNAVAILABLE" },
				});
				late?.({
					send: async () => {},
					frames: { async *[Symbol.asyncIterator]() {} },
					close: () => {
						closed = true;
					},
				});
				yield* Effect.yieldNow();
				expect(closed).toBe(true);
			}),
	);
	for (const raw of [
		"malformed",
		frame(1, "out-of-order"),
		frame(0, "error", 1),
	])
		it.effect("Spark rejects malformed/error/out-of-order frame", () =>
			Effect.gen(function* () {
				const adapter = makeSparkAdapter(async () => ({
					send: async () => {},
					close: () => {},
					frames: {
						async *[Symbol.asyncIterator]() {
							yield raw;
						},
					},
				}));
				expect(
					yield* Effect.either(
						Stream.runDrain(yield* adapter.open(input(sparkProfile))),
					),
				).toMatchObject({
					_tag: "Left",
					left: { code: "AI.PROVIDER.PROTOCOL_INVALID" },
				});
			}),
		);
});
