import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Schema, Stream } from "effect";
import type { CompatibleAdapter } from "./adapters/adapter.js";
import type { NormalizedEvent } from "./ai-contracts.js";
import { AiRepository } from "./ai-repository.js";
import { AiProviderService } from "./ai-service.js";
import {
	workflowLayer,
	workflowProfile,
	workflowRequest,
} from "./ai-test-fixtures.js";
import { ProviderOptions } from "./ai-workflow-contracts.js";

describe("workflow control intent through the facade", () => {
	it.effect(
		"preserves GPT-5.1 reasoning defaults and explicit controls",
		() => {
			const calls: Parameters<CompatibleAdapter["open"]>[0][] = [];
			return Effect.gen(function* () {
				yield* (yield* AiRepository).put({
					...workflowProfile,
					provider: "openai",
					models: { daily: "gpt-5.1" },
				});
				const service = yield* AiProviderService;
				for (const [controls, expected] of [
					[undefined, {}],
					[{ thinking: false }, { reasoning_effort: "none" }],
					[{ thinking: true }, { reasoning_effort: "high" }],
					[{ reasoningEffort: "low" }, { reasoning_effort: "low" }],
					[{ reasoningEffort: "medium" }, { reasoning_effort: "medium" }],
					[{ reasoningEffort: "high" }, { reasoning_effort: "high" }],
					[
						{ thinking: true, reasoningEffort: "medium" },
						{ reasoning_effort: "medium" },
					],
					[
						{ thinking: false, reasoningEffort: "low" },
						{ reasoning_effort: "low" },
					],
				] as const) {
					const generation = yield* service.generate({
						...workflowRequest,
						...(controls ? { controls } : {}),
					});
					yield* Stream.runDrain(generation.events);
					const options = calls.at(-1)?.providerOptions;
					expect(options).toEqual(expected);
					expect(
						Either.isRight(
							Schema.decodeUnknownEither(ProviderOptions)(options),
						),
					).toBe(true);
				}
				for (const reasoningEffort of ["medium", "high"] as const) {
					const result = yield* Effect.either(
						service.generate({
							...workflowRequest,
							controls: { thinking: false, reasoningEffort },
						}),
					);
					expect(Either.isLeft(result) && result.left).toMatchObject({
						_tag: "AiConfigInvalid",
						code: "AI.PROVIDER.CONFIG_INVALID",
					});
				}
				expect(calls).toHaveLength(8);
			}).pipe(
				Effect.provide(
					workflowLayer({
						open: (input) => {
							calls.push(input);
							return Effect.succeed(
								Stream.fromIterable<NormalizedEvent>([
									{
										_tag: "textDelta",
										textDelta: "fixture answer",
										kind: "generation",
									},
									{ _tag: "completed" },
								]),
							);
						},
					}),
				),
			);
		},
	);
	it.effect(
		"rejects custom prompts on presets before credentials and dispatch",
		() =>
			Effect.gen(function* () {
				yield* (yield* AiRepository).put(workflowProfile);
				for (const customPrompt of ["custom instructions", ""]) {
					const result = yield* Effect.either(
						(yield* AiProviderService).generate({
							...workflowRequest,
							persona: { roleId: 128, locale: "en", customPrompt },
						}),
					);
					expect(Either.isLeft(result) && result.left).toMatchObject({
						_tag: "AiConfigInvalid",
						code: "AI.PROVIDER.CONFIG_INVALID",
					});
				}
			}).pipe(
				Effect.provide(
					workflowLayer(
						{
							open: () => Effect.die("preset custom prompt must not dispatch"),
						},
						{
							resolve: () =>
								Effect.die("preset custom prompt must not resolve credentials"),
							revoked: () => Effect.never,
						},
					),
				),
			),
	);
	it.effect("dispatches a custom role prompt without discarding it", () => {
		const calls: Parameters<CompatibleAdapter["open"]>[0][] = [];
		return Effect.gen(function* () {
			yield* (yield* AiRepository).put(workflowProfile);
			const generation = yield* (yield* AiProviderService).generate({
				...workflowRequest,
				persona: {
					roleId: -1,
					locale: "en",
					customPrompt: "custom instructions",
				},
			});
			yield* Stream.runDrain(generation.events);
			expect(calls).toHaveLength(1);
			expect(calls[0]?.request.messages).toEqual([
				{
					role: "system",
					content: [{ _tag: "text", text: "custom instructions" }],
				},
				...workflowRequest.messages,
			]);
		}).pipe(
			Effect.provide(
				workflowLayer({
					open: (input) => {
						calls.push(input);
						return Effect.succeed(
							Stream.fromIterable<NormalizedEvent>([
								{
									_tag: "textDelta",
									textDelta: "fixture answer",
									kind: "generation",
								},
								{ _tag: "completed" },
							]),
						);
					},
				}),
			),
		);
	});
});
