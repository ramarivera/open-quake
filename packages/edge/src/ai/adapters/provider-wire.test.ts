import { describe, expect, it } from "@effect/vitest";
import { Chunk, Effect, Either, Stream } from "effect";
import { AiRepository } from "../ai-repository.js";
import { AiProviderService } from "../ai-service.js";
import {
	workflowLayer,
	workflowProfile,
	workflowRequest,
} from "../ai-test-fixtures.js";
import { makeVercelCompatibleAdapter } from "./vercel.js";

const sse = (...frames: unknown[]) =>
	new Response(
		frames
			.map(
				(frame) =>
					`data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`,
			)
			.join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);
const answer = {
	choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }],
};
const stop = {
	choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
	usage: { prompt_tokens: 4, completion_tokens: 2 },
};
const tool = {
	choices: [
		{
			index: 0,
			delta: {
				tool_calls: [
					{
						index: 0,
						id: "call-1",
						type: "function",
						function: { name: "lookup", arguments: '{"query":"fixture"}' },
					},
				],
			},
			finish_reason: "tool_calls",
		},
	],
};
const definition = {
	name: "lookup",
	description: "Local fixture lookup",
	properties: { query: { type: "string" as const } },
	required: ["query"],
};
describe("retained provider wire fixtures", () => {
	for (const provider of ["openai", "qwen"] as const)
		it.effect(
			`AI-037 ${provider} executes only a declared host tool and sends correlated follow-up`,
			() => {
				const requests: unknown[] = [];
				const executions: unknown[] = [];
				const adapter = makeVercelCompatibleAdapter(
					async (_url, init) => {
						requests.push(JSON.parse(String(init?.body)));
						return requests.length === 1
							? sse(tool, "[DONE]")
							: sse(answer, stop, "[DONE]");
					},
					{
						execute: (name, args, signal) =>
							Effect.sync(() => {
								expect(signal.aborted).toBe(false);
								executions.push({ name, args });
								return "local result";
							}),
					},
				);
				return Effect.gen(function* () {
					yield* AiRepository.put({
						...workflowProfile,
						provider,
						modelId: "gpt-4o",
						models: { daily: provider === "openai" ? "gpt-4o" : "qwen-plus" },
						capabilities: {
							...workflowProfile.capabilities,
							tools: "supported",
						},
					});
					const generation = yield* AiProviderService.generate({
						...workflowRequest,
						tools: [definition],
					});
					const events = Chunk.toReadonlyArray(
						yield* Stream.runCollect(generation.events),
					);
					expect(events.at(-1)?._tag).toBe("completed");
					expect(requests).toHaveLength(2);
					expect(executions).toEqual([
						{ name: "lookup", args: { query: "fixture" } },
					]);
					expect(requests[1]).toMatchObject({
						messages: [
							{ role: "user", content: "hello" },
							{
								role: "assistant",
								tool_calls: [
									{
										id: "call-1",
										function: {
											name: "lookup",
											arguments: '{"query":"fixture"}',
										},
									},
								],
							},
							{ role: "tool", tool_call_id: "call-1", content: "local result" },
						],
					});
				}).pipe(Effect.provide(workflowLayer(adapter)));
			},
		);
	for (const provider of ["kimi", "deepseek"] as const)
		for (const reasoning of [undefined, "retained reasoning"])
			it.effect(
				`AI-032/033 ${provider} preserves reasoning ${reasoning ?? "placeholder"} and tool IDs`,
				() => {
					let body: unknown;
					const adapter = makeVercelCompatibleAdapter(async (_url, init) => {
						body = JSON.parse(String(init?.body));
						return sse(answer, stop, "[DONE]");
					});
					return Effect.gen(function* () {
						yield* AiRepository.put({
							...workflowProfile,
							provider,
							models: {
								daily: provider === "kimi" ? "kimi-k2.5" : "deepseek-chat",
							},
							capabilities: {
								...workflowProfile.capabilities,
								tools: "supported",
							},
						});
						const generation = yield* AiProviderService.generate({
							...workflowRequest,
							messages: [
								...workflowRequest.messages,
								{
									role: "assistant",
									content: [],
									...(reasoning === undefined
										? {}
										: { reasoningContent: reasoning }),
									toolCalls: [
										{
											id: "history-1",
											name: "lookup",
											arguments: '{"query":"old"}',
										},
									],
								},
								{
									role: "tool",
									content: [{ _tag: "text", text: "old result" }],
									toolCallId: "history-1",
									toolName: "lookup",
								},
							],
						});
						yield* Stream.runDrain(generation.events);
						expect(body).toMatchObject({
							messages: [
								{ role: "user" },
								{
									role: "assistant",
									reasoning_content: reasoning ?? "",
									tool_calls: [
										{
											id: "history-1",
											function: {
												name: "lookup",
												arguments: '{"query":"old"}',
											},
										},
									],
								},
								{
									role: "tool",
									tool_call_id: "history-1",
									content: "old result",
								},
							],
						});
					}).pipe(Effect.provide(workflowLayer(adapter)));
				},
			);
	for (const provider of ["groq", "zhipu", "volc"] as const)
		it.effect(
			`AI-028/034/051 ${provider} sends credentials only to selected endpoint`,
			() => {
				let destination = "";
				let body: unknown;
				let auth = "";
				const urls = {
					groq: "https://api.groq.com/openai/v1",
					zhipu: "https://open.bigmodel.cn/api/paas/v4",
					volc: "https://ark.cn-beijing.volces.com/api/v3/bots",
				};
				const adapter = makeVercelCompatibleAdapter(async (url, init) => {
					destination = String(url);
					auth = new Headers(init?.headers).get("authorization") ?? "";
					body = JSON.parse(String(init?.body));
					expect(init?.redirect).toBe("error");
					return sse(answer, stop, "[DONE]");
				});
				return Effect.gen(function* () {
					yield* AiRepository.put({
						...workflowProfile,
						provider,
						baseUrl: urls[provider],
						models: { daily: "explicit-custom-id" },
					});
					const generation = yield* AiProviderService.generate(workflowRequest);
					yield* Stream.runDrain(generation.events);
					expect(destination).toBe(`${urls[provider]}/chat/completions`);
					expect(auth).toBe("Bearer fixture-key");
					expect(body).toMatchObject({ model: "explicit-custom-id" });
				}).pipe(Effect.provide(workflowLayer(adapter)));
			},
		);
	for (const provider of ["qwen", "zhipu"] as const)
		for (const enabled of [false, true])
			it.effect(
				`AI-031/118 ${provider} search ${enabled} retains selected provenance only`,
				() => {
					let body: unknown;
					let calls = 0;
					const adapter = makeVercelCompatibleAdapter(async (_url, init) => {
						calls++;
						body = JSON.parse(String(init?.body));
						return sse(
							{
								...answer,
								search_info: {
									search_results: [
										{
											title: "Qwen [source]",
											link: "https://evidence.invalid/q",
										},
									],
								},
								web_search: [
									{ title: "ZhiPu source", link: "https://evidence.invalid/z" },
									{ title: "unsafe", link: "javascript:alert(1)" },
								],
							},
							stop,
							"[DONE]",
						);
					});
					return Effect.gen(function* () {
						yield* AiRepository.put({ ...workflowProfile, provider });
						const generation = yield* AiProviderService.generate({
							...workflowRequest,
							controls: {
								webSearch: enabled,
								...(enabled && provider === "qwen"
									? {
											searchOptions: {
												enable_source: true,
												search_strategy: "pro" as const,
											},
										}
									: {}),
							},
						});
						const events = Chunk.toReadonlyArray(
							yield* Stream.runCollect(generation.events),
						);
						const text = events
							.flatMap((e) => (e._tag === "textDelta" ? [e.textDelta] : []))
							.join("");
						expect(calls).toBe(1);
						expect(text.includes("Sources from provider search")).toBe(enabled);
						expect(text).not.toContain("javascript:");
						if (provider === "qwen")
							expect(body).toMatchObject({
								enable_search: enabled,
								...(enabled
									? {
											search_options: {
												enable_source: true,
												search_strategy: "pro",
											},
										}
									: {}),
							});
						else if (enabled)
							expect(body).toMatchObject({
								tools: [
									{
										type: "web_search",
										web_search: {
											enable: true,
											search_result: true,
											search_query: "hello",
										},
									},
								],
							});
						else expect(body).not.toHaveProperty("tools");
					}).pipe(Effect.provide(workflowLayer(adapter)));
				},
			);
});

it.effect("AI-037 repeated tool calls stop at the bounded step budget", () => {
	let calls = 0;
	let executions = 0;
	const adapter = makeVercelCompatibleAdapter(
		async () => {
			calls++;
			return sse(
				{
					...tool,
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: 0,
										id: `call-${calls}`,
										type: "function",
										function: {
											name: "lookup",
											arguments: '{"query":"fixture"}',
										},
									},
								],
							},
							finish_reason: "tool_calls",
						},
					],
				},
				"[DONE]",
			);
		},
		{
			execute: () =>
				Effect.sync(() => {
					executions++;
					return "result";
				}),
		},
	);
	return Effect.gen(function* () {
		yield* AiRepository.put({
			...workflowProfile,
			capabilities: { ...workflowProfile.capabilities, tools: "supported" },
		});
		const generation = yield* AiProviderService.generate({
			...workflowRequest,
			tools: [definition],
		});
		const result = yield* Effect.either(Stream.runDrain(generation.events));
		expect(Either.isLeft(result)).toBe(true);
		expect(calls).toBe(4);
		expect(executions).toBe(4);
	}).pipe(Effect.provide(workflowLayer(adapter)));
});

it.effect(
	"AI-037 rejects a truncated tool step before a follow-up answer",
	() => {
		let calls = 0;
		const adapter = makeVercelCompatibleAdapter(
			async () => {
				calls++;
				return calls === 1
					? sse(
							{
								...tool,
								choices: tool.choices.map((choice) => ({
									...choice,
									finish_reason: "length",
								})),
							},
							"[DONE]",
						)
					: sse(answer, stop, "[DONE]");
			},
			{ execute: () => Effect.succeed("local result") },
		);
		return Effect.gen(function* () {
			yield* AiRepository.put({
				...workflowProfile,
				capabilities: { ...workflowProfile.capabilities, tools: "supported" },
			});
			const generation = yield* AiProviderService.generate({
				...workflowRequest,
				tools: [definition],
			});
			const result = yield* Effect.either(Stream.runCollect(generation.events));
			expect(Either.isLeft(result) && result.left.code).toBe(
				"AI.PROVIDER.PROTOCOL_INVALID",
			);
		}).pipe(Effect.provide(workflowLayer(adapter)));
	},
);

it.effect(
	"AI-037 accepts three tool steps and completes only after the fourth-step answer",
	() => {
		let calls = 0;
		let executions = 0;
		const adapter = makeVercelCompatibleAdapter(
			async () => {
				calls++;
				return calls < 4
					? sse(
							{
								...tool,
								choices: tool.choices.map((choice) => ({
									...choice,
									delta: {
										tool_calls: choice.delta.tool_calls.map((call) => ({
											...call,
											id: `call-${calls}`,
										})),
									},
								})),
							},
							"[DONE]",
						)
					: sse(answer, stop, "[DONE]");
			},
			{
				execute: () =>
					Effect.sync(() => {
						executions++;
						return "local result";
					}),
			},
		);
		return Effect.gen(function* () {
			yield* AiRepository.put({
				...workflowProfile,
				capabilities: { ...workflowProfile.capabilities, tools: "supported" },
			});
			const generation = yield* AiProviderService.generate({
				...workflowRequest,
				tools: [definition],
			});
			const events = Chunk.toReadonlyArray(
				yield* Stream.runCollect(generation.events),
			);
			expect(calls).toBe(4);
			expect(executions).toBe(3);
			expect(events).toEqual([
				{ _tag: "textDelta", textDelta: "answer", kind: "generation" },
				{
					_tag: "usage",
					usage: { inputTokens: 4, outputTokens: 2, provenance: "reported" },
				},
				{ _tag: "completed" },
			]);
		}).pipe(Effect.provide(workflowLayer(adapter)));
	},
);
