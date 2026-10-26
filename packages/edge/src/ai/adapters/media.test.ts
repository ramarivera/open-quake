import { describe, expect, it } from "@effect/vitest";
import {
	Chunk,
	Deferred,
	Effect,
	Either,
	Fiber,
	Redacted,
	Stream,
	TestClock,
} from "effect";
import { AiRepository } from "../ai-repository.js";
import { AiProviderService } from "../ai-service.js";
import {
	workflowLayer,
	workflowProfile,
	workflowRequest,
} from "../ai-test-fixtures.js";
import { makeProviderAdapter } from "./provider-adapter.js";

for (const kind of ["image", "video"] as const)
	describe(`AI-007 explicit ${kind} transport`, () => {
		const profile = {
			...workflowProfile,
			adapter: "dashscope-media" as const,
			baseUrl: "https://selected.invalid/api/v1",
			settings: { mediaKind: kind },
			models: { daily: "explicit-model", [kind]: "explicit-model" },
			capabilities: {
				...workflowProfile.capabilities,
				imageGeneration: "supported" as const,
				videoGeneration: "supported" as const,
			},
		};
		it.effect(
			"identifies image and tool rejection before network access",
			() => {
				const adapter = makeProviderAdapter(async () => {
					throw new Error("Rejected capabilities must not reach the network");
				});
				return Effect.gen(function* () {
					for (const capability of ["images", "tools"] as const) {
						const result = yield* Effect.either(
							adapter.open({
								profile,
								request: {
									...workflowRequest,
									messages: [
										{
											role: "user",
											content:
												capability === "images"
													? [
															{
																_tag: "image",
																url: "https://image.invalid/fixture.png",
															},
														]
													: [{ _tag: "text", text: "hello" }],
										},
									],
									...(capability === "tools"
										? {
												tools: [
													{
														name: "fixture",
														description: "fixture",
														properties: {},
														required: [],
													},
												],
											}
										: {}),
								},
								providerOptions: {},
								credential: Redacted.make("fixture-key"),
								signal: new AbortController().signal,
								redirectPolicy: "error",
								maxRetries: 0,
							}),
						);
						expect(Either.isLeft(result)).toBe(true);
						if (Either.isRight(result))
							throw new Error("Expected capability refusal");
						expect(result.left.code).toBe("AI.PROVIDER.CAPABILITY_UNSUPPORTED");
						if (result.left._tag !== "AiCapabilityUnsupported")
							throw new Error("Expected capability error");
						expect(result.left.capability).toBe(capability);
					}
				});
			},
		);
		it.effect(
			"uses selected endpoint and credentials, polls correlated task, emits validated asset",
			() => {
				const calls: { url: string; body: unknown }[] = [];
				const adapter = makeProviderAdapter(async (url, init) => {
					calls.push({
						url: String(url),
						body: init?.body ? JSON.parse(String(init.body)) : undefined,
					});
					expect(new Headers(init?.headers).get("authorization")).toBe(
						"Bearer fixture-key",
					);
					expect(init?.redirect).toBe("error");
					return Response.json(
						calls.length === 1
							? { output: { task_id: "task_1", task_status: "PENDING" } }
							: {
									output: {
										task_id: "task_1",
										task_status: "SUCCEEDED",
										results: [{ url: "https://cdn.invalid/image.png" }],
										video_url: "https://cdn.invalid/video.mp4",
									},
								},
					);
				});
				return Effect.gen(function* () {
					yield* AiRepository.put(profile);
					const generation = yield* AiProviderService.generate({
						...workflowRequest,
						modelRole: kind,
					});
					const events = Chunk.toReadonlyArray(
						yield* Stream.runCollect(generation.events),
					);
					expect(events).toEqual([
						{
							_tag: "textDelta",
							kind: "generation",
							textDelta: `[Generated ${kind}](https://cdn.invalid/${kind}.${kind === "image" ? "png" : "mp4"})`,
						},
						{ _tag: "completed" },
					]);
					expect(calls).toHaveLength(2);
					expect(calls[0]?.url).toBe(
						`https://selected.invalid/api/v1/services/aigc/${kind === "image" ? "text2image/image-synthesis" : "video-generation/video-synthesis"}`,
					);
					expect(calls[0]?.body).toMatchObject({
						model: "explicit-model",
						input: { prompt: "hello" },
					});
					expect(calls[1]?.url).toBe(
						"https://selected.invalid/api/v1/tasks/task_1",
					);
				}).pipe(Effect.provide(workflowLayer(adapter)));
			},
		);
		it.effect("cancels pending polling without sidecar requests", () => {
			const polled = Effect.runSync(Deferred.make<void>());
			let calls = 0;
			let signal: AbortSignal | null | undefined;
			const adapter = makeProviderAdapter(async (_url, init) => {
				signal = init?.signal;
				calls++;
				if (calls === 2) Effect.runSync(Deferred.succeed(polled, undefined));
				return Response.json({
					output: { task_id: "task_1", task_status: "RUNNING" },
				});
			});
			return Effect.gen(function* () {
				yield* AiRepository.put(profile);
				const generation = yield* AiProviderService.generate({
					...workflowRequest,
					modelRole: kind,
				});
				const fiber = yield* Stream.runDrain(generation.events).pipe(
					Effect.fork,
				);
				yield* Deferred.await(polled);
				yield* generation.cancel();
				yield* Fiber.join(fiber);
				yield* TestClock.adjust("30 seconds");
				expect(calls).toBe(2);
				expect(signal?.aborted).toBe(true);
			}).pipe(Effect.provide(workflowLayer(adapter)));
		});
		it.effect("fails malformed/foreign task before exposing a result", () => {
			let calls = 0;
			const adapter = makeProviderAdapter(async () =>
				Response.json({
					output: {
						task_id: calls++ === 0 ? "owned" : "foreign",
						task_status: "SUCCEEDED",
						video_url: "https://cdn.invalid/video.mp4",
					},
				}),
			);
			return Effect.gen(function* () {
				yield* AiRepository.put(profile);
				const generation = yield* AiProviderService.generate({
					...workflowRequest,
					modelRole: kind,
				});
				const result = yield* Effect.either(Stream.runDrain(generation.events));
				expect(Either.isLeft(result) && result.left.code).toBe(
					"AI.PROVIDER.PROTOCOL_INVALID",
				);
			}).pipe(Effect.provide(workflowLayer(adapter)));
		});
	});
