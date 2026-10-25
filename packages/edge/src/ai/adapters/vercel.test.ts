import { createServer } from "node:http";
import { describe, expect, it } from "@effect/vitest";
import {
	Chunk,
	Deferred,
	Effect,
	Either,
	Fiber,
	Redacted,
	Stream,
} from "effect";
import { AiRepository } from "../ai-repository.js";
import { AiProviderService } from "../ai-service.js";
import {
	workflowLayer,
	workflowProfile,
	workflowRequest,
} from "../ai-test-fixtures.js";
import { makeVercelCompatibleAdapter } from "./vercel.js";

const sse = (...items: unknown[]) =>
	items
		.map(
			(item) =>
				`data: ${typeof item === "string" ? item : JSON.stringify(item)}\n\n`,
		)
		.join("");
const delta = (content: string) => ({
	choices: [{ index: 0, delta: { content }, finish_reason: null }],
});
const stop = {
	choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
	usage: { prompt_tokens: 12, completion_tokens: 2 },
};
const response = (text: string) =>
	new Response(text, { headers: { "content-type": "text/event-stream" } });

describe("production Vercel compatible adapter through real AiProviderService", () => {
	it.effect(
		"sends selected role, credentials, sampling and Qwen options through SDK; normalizes usage and text",
		() => {
			const requests: {
				url: string;
				init: RequestInit | undefined;
				body: Record<string, unknown>;
			}[] = [];
			const adapter = makeVercelCompatibleAdapter(async (url, init) => {
				requests.push({
					url: String(url),
					init,
					body: JSON.parse(String(init?.body)) as Record<string, unknown>,
				});
				// Fragmenting inside UTF-8 and JSON is handled by the actual SDK parser.
				const bytes = new TextEncoder().encode(
					sse(delta("Hé"), delta("llo"), stop, "[DONE]"),
				);
				return new Response(
					new ReadableStream({
						start(controller) {
							for (let offset = 0; offset < bytes.length; offset += 3)
								controller.enqueue(bytes.slice(offset, offset + 3));
							controller.close();
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				);
			});
			return Effect.gen(function* () {
				yield* (yield* AiRepository).put(workflowProfile);
				const generation = yield* (yield* AiProviderService).generate({
					...workflowRequest,
					messages: [
						{
							role: "system",
							content: [{ _tag: "text", text: "Keep text inert" }],
						},
						...workflowRequest.messages,
					],
					controls: { thinking: false, webSearch: true },
					sampling: { temperature: 0.4, topP: 0.9, maxOutputTokens: 128 },
				});
				const events = Chunk.toReadonlyArray(
					yield* Stream.runCollect(generation.events),
				);
				expect(events).toEqual([
					{ _tag: "textDelta", textDelta: "Hé", kind: "generation" },
					{ _tag: "textDelta", textDelta: "llo", kind: "generation" },
					{
						_tag: "usage",
						usage: { inputTokens: 12, outputTokens: 2, provenance: "reported" },
					},
					{ _tag: "completed" },
				]);
				expect(requests).toHaveLength(1);
				expect(requests[0]?.url).toBe(
					"https://mock.invalid/v1/chat/completions",
				);
				expect(requests[0]?.init?.redirect).toBe("error");
				expect(
					new Headers(requests[0]?.init?.headers).get("authorization"),
				).toBe("Bearer fixture-key");
				expect(requests[0]?.body).toMatchObject({
					model: "daily",
					enable_thinking: false,
					enable_search: true,
					max_tokens: 128,
					temperature: 0.4,
					top_p: 0.9,
					stream_options: { include_usage: true },
				});
				expect(requests[0]?.body.tools).toBeUndefined();
			}).pipe(Effect.provide(workflowLayer(adapter)));
		},
	);
	it.effect(
		"maps OpenAI max_completion_tokens and reasoning without max_tokens",
		() => {
			let body: Record<string, unknown> = {};
			const adapter = makeVercelCompatibleAdapter(async (_url, init) => {
				body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				return response(sse(delta("safe"), stop, "[DONE]"));
			});
			return Effect.gen(function* () {
				yield* (yield* AiRepository).put({
					...workflowProfile,
					provider: "openai",
					models: { daily: "gpt-5.1" },
				});
				const generation = yield* (yield* AiProviderService).generate({
					...workflowRequest,
					controls: { reasoningEffort: "high", webSearch: true },
					sampling: { maxOutputTokens: 99 },
				});
				yield* Stream.runDrain(generation.events);
				expect(body).toMatchObject({
					model: "gpt-5.1",
					max_completion_tokens: 99,
					reasoning_effort: "high",
					web_search_options: { search_context_size: "medium" },
				});
				expect(body.max_tokens).toBeUndefined();
			}).pipe(Effect.provide(workflowLayer(adapter)));
		},
	);
	for (const [status, tag, code] of [
		[401, "AiAuthRequired", "AI.PROVIDER.AUTH_REQUIRED"],
		[429, "AiRateLimited", "AI.PROVIDER.RATE_LIMITED"],
		[503, "AiUnavailable", "AI.PROVIDER.UNAVAILABLE"],
	] as const) {
		it.effect(
			`normalizes HTTP ${status}, retains private cause and never retries`,
			() => {
				let calls = 0;
				const adapter = makeVercelCompatibleAdapter(async () => {
					calls++;
					return new Response(
						JSON.stringify({
							error: {
								message: "secret-user-text fixture-key https://private.invalid",
							},
						}),
						{ status, headers: { "content-type": "application/json" } },
					);
				});
				return Effect.gen(function* () {
					yield* (yield* AiRepository).put(workflowProfile);
					const generation = yield* (yield* AiProviderService).generate(
						workflowRequest,
					);
					const result = yield* Effect.either(
						Stream.runDrain(generation.events),
					);
					expect(Either.isLeft(result)).toBe(true);
					if (Either.isLeft(result)) {
						expect(result.left._tag).toBe(tag);
						expect(result.left.code).toBe(code);
						expect(result.left.originalCause).toBeDefined();
						expect(JSON.stringify(result.left)).not.toMatch(
							/secret-user-text|fixture-key|private.invalid/,
						);
					}
					expect(calls).toBe(1);
				}).pipe(Effect.provide(workflowLayer(adapter)));
			},
		);
	}
	for (const text of [
		sse(delta("partial"), "[DONE]"),
		sse(
			delta("partial"),
			{ choices: [{ index: 0, delta: {}, finish_reason: "length" }] },
			"[DONE]",
		),
	]) {
		it.effect(
			"fails missing or truncated terminal instead of completing partial output",
			() =>
				Effect.gen(function* () {
					yield* (yield* AiRepository).put(workflowProfile);
					const generation = yield* (yield* AiProviderService).generate(
						workflowRequest,
					);
					const result = yield* Effect.either(
						Stream.runDrain(generation.events),
					);
					expect(Either.isLeft(result) && result.left.code).toBe(
						"AI.PROVIDER.PROTOCOL_INVALID",
					);
				}).pipe(
					Effect.provide(
						workflowLayer(
							makeVercelCompatibleAdapter(async () => response(text)),
						),
					),
				),
		);
	}
	it.effect(
		"does not transmit images or request tools through this text adapter",
		() => {
			let calls = 0;
			return Effect.gen(function* () {
				const adapter = makeVercelCompatibleAdapter(async () => {
					calls++;
					return response("");
				});
				const result = yield* Effect.either(
					adapter.open({
						profile: workflowProfile,
						request: { ...workflowRequest, requestedCapabilities: ["tools"] },
						providerOptions: {},
						credential: Redacted.make("key"),
						signal: new AbortController().signal,
						redirectPolicy: "error",
						maxRetries: 0,
					}),
				);
				expect(Either.isLeft(result) && result.left.code).toBe(
					"AI.PROVIDER.CAPABILITY_UNSUPPORTED",
				);
				expect(calls).toBe(0);
			});
		},
	);
	it("blocks an actual cross-origin HTTP redirect before credentials reach the destination", async () => {
		let forwarded = 0;
		const destination = createServer((_request, res) => {
			forwarded++;
			res.end();
		});
		const source = createServer((_request, res) => {
			const address = destination.address();
			if (address && typeof address !== "string") {
				res.writeHead(302, {
					location: `http://127.0.0.1:${address.port}/stolen`,
				});
				res.end();
			}
		});
		await new Promise<void>((resolve) =>
			destination.listen(0, "127.0.0.1", resolve),
		);
		await new Promise<void>((resolve) =>
			source.listen(0, "127.0.0.1", resolve),
		);
		try {
			const address = source.address();
			if (!address || typeof address === "string")
				throw new Error("fixture address missing");
			const profile = {
				...workflowProfile,
				baseUrl: `http://127.0.0.1:${address.port}/v1`,
				endpointPolicy: "loopback" as const,
			};
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					yield* (yield* AiRepository).put(profile);
					const generation = yield* (yield* AiProviderService).generate(
						workflowRequest,
					);
					return yield* Effect.either(Stream.runDrain(generation.events));
				}).pipe(Effect.provide(workflowLayer(makeVercelCompatibleAdapter()))),
			);
			expect(Either.isLeft(result)).toBe(true);
			expect(forwarded).toBe(0);
		} finally {
			source.closeAllConnections();
			destination.closeAllConnections();
			await Promise.all([
				new Promise<void>((resolve) => source.close(() => resolve())),
				new Promise<void>((resolve) => destination.close(() => resolve())),
			]);
		}
	});
});

describe("SDK abort and untrusted response boundaries", () => {
	it.effect(
		"physically aborts a pending production SDK fetch when the real facade is cancelled",
		() => {
			const started = Effect.runSync(Deferred.make<void>());
			let aborted = false;
			let calls = 0;
			const adapter = makeVercelCompatibleAdapter(
				(_url, init) =>
					new Promise<Response>((_resolve, reject) => {
						calls++;
						const signal = init?.signal;
						const abort = () => {
							aborted = true;
							reject(new DOMException("Aborted", "AbortError"));
						};
						if (signal?.aborted) abort();
						else signal?.addEventListener("abort", abort, { once: true });
						Effect.runSync(Deferred.succeed(started, undefined));
					}),
			);
			return Effect.gen(function* () {
				yield* (yield* AiRepository).put(workflowProfile);
				const generation = yield* (yield* AiProviderService).generate(
					workflowRequest,
				);
				const consumer = yield* Stream.runCollect(generation.events).pipe(
					Effect.fork,
				);
				yield* Deferred.await(started);
				yield* generation.cancel();
				expect(Chunk.toReadonlyArray(yield* Fiber.join(consumer))).toEqual([]);
				expect(aborted).toBe(true);
				expect(calls).toBe(1);
			}).pipe(Effect.provide(workflowLayer(adapter)));
		},
	);
	it.effect(
		"rejects malformed SSE with protocol identity and keeps raw provider bodies private",
		() =>
			Effect.gen(function* () {
				yield* (yield* AiRepository).put(workflowProfile);
				const generation = yield* (yield* AiProviderService).generate(
					workflowRequest,
				);
				const result = yield* Effect.either(Stream.runDrain(generation.events));
				expect(Either.isLeft(result)).toBe(true);
				if (Either.isLeft(result)) {
					expect(result.left.code).toBe("AI.PROVIDER.PROTOCOL_INVALID");
					expect(result.left.originalCause).toBeDefined();
					expect(JSON.stringify(result.left)).not.toContain(
						"private malformed payload",
					);
				}
			}).pipe(
				Effect.provide(
					workflowLayer(
						makeVercelCompatibleAdapter(async () =>
							response("data: private malformed payload\n\n"),
						),
					),
				),
			),
	);
	it.effect("never executes unsolicited model tool output", () =>
		Effect.gen(function* () {
			yield* (yield* AiRepository).put(workflowProfile);
			const generation = yield* (yield* AiProviderService).generate(
				workflowRequest,
			);
			const result = yield* Effect.either(Stream.runDrain(generation.events));
			expect(Either.isLeft(result) && result.left.code).toBe(
				"AI.PROVIDER.CAPABILITY_UNSUPPORTED",
			);
		}).pipe(
			Effect.provide(
				workflowLayer(
					makeVercelCompatibleAdapter(async () =>
						response(
							sse(
								{
									choices: [
										{
											index: 0,
											delta: {
												tool_calls: [
													{
														index: 0,
														id: "call",
														type: "function",
														function: {
															name: "executeCommand",
															arguments: "{}",
														},
													},
												],
											},
											finish_reason: "tool_calls",
										},
									],
								},
								"[DONE]",
							),
						),
					),
				),
			),
		),
	);
});
