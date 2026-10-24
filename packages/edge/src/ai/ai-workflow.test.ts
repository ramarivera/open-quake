import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Option, Stream } from "effect";
import * as fc from "fast-check";
import type { CompatibleAdapter } from "./adapters/adapter.js";
import { prepareWorkflow } from "./ai-provider-quirks.js";
import { AiRepository } from "./ai-repository.js";
import {
	AiLocale,
	COPILOT_PRESETS,
	ROLE_PRESETS,
	selectRole,
} from "./ai-role-presets.js";
import { AiProviderService } from "./ai-service.js";

import {
	workflowLayer,
	workflowProfile,
	workflowRequest,
} from "./ai-test-fixtures.js";

describe("profile workflows", () => {
	it.effect(
		"selects daily and routing models through the facade, pinning snapshots and role prompts",
		() => {
			const calls: Parameters<CompatibleAdapter["open"]>[0][] = [];
			return Effect.gen(function* () {
				const repository = yield* AiRepository;
				yield* repository.put(workflowProfile);
				const service = yield* AiProviderService;
				for (const modelRole of ["daily", "routing", "deepThink"] as const) {
					const generation = yield* service.generate({
						...workflowRequest,
						modelRole,
						controls: { thinking: true, webSearch: true },
						persona: { roleId: 128, locale: "de" },
					});
					yield* Stream.runDrain(generation.events);
				}
				expect(calls.map((c) => c.profile.modelId)).toEqual([
					"daily",
					"router",
					"deep",
				]);
				expect(calls[0]?.providerOptions).toEqual({
					enable_thinking: true,
					enable_search: true,
				});
				expect(calls[0]?.request.messages[0]?.content).toEqual([
					{
						_tag: "text",
						text: ROLE_PRESETS.find((p) => p.id === 128)?.prompt,
					},
				]);
				const stored = yield* repository.get(workflowProfile.id);
				expect(Option.isSome(stored) && stored.value.modelId).toBe(
					workflowProfile.modelId,
				);
				expect(
					Option.isSome(stored) && Object.isFrozen(stored.value.models),
				).toBe(true);
			}).pipe(
				Effect.provide(
					workflowLayer({
						open: (input) => {
							calls.push(input);
							return Effect.succeed(Stream.succeed({ _tag: "completed" }));
						},
					}),
				),
			);
		},
	);
	it.effect(
		"rejects unsupported role modalities, controls and dropped personas before credentials",
		() =>
			Effect.gen(function* () {
				const repo = yield* AiRepository;
				yield* repo.put({ ...workflowProfile, provider: "deepseek" });
				const service = yield* AiProviderService;
				for (const extra of [
					{ modelRole: "vision" },
					{ controls: { webSearch: true } },
					{ persona: { roleId: 122, locale: "en" } },
					{ persona: { roleId: 124, locale: "en" } },
				]) {
					const result = yield* Effect.either(
						service.generate({ ...workflowRequest, ...extra }),
					);
					expect(Either.isLeft(result)).toBe(true);
				}
			}).pipe(
				Effect.provide(
					workflowLayer(
						{ open: () => Effect.die("must not dispatch") },
						{
							resolve: () => Effect.die("must not resolve"),
							revoked: () => Effect.never,
						},
					),
				),
			),
	);
	it("encodes explicit OpenAI, Qwen and Kimi quirks without silently stripping sampling", () => {
		const openai = prepareWorkflow(
			{
				...workflowProfile,
				provider: "openai",
				models: { daily: "gpt-5.1" },
				controls: { thinking: true, webSearch: true },
			},
			{ ...workflowRequest, sampling: { maxOutputTokens: 2048 } },
		);
		expect(Either.isRight(openai) && openai.right.providerOptions).toEqual({
			reasoning_effort: "high",
			web_search_options: { search_context_size: "medium" },
			max_completion_tokens: 2048,
		});
		expect(
			Either.isLeft(
				prepareWorkflow(
					{ ...workflowProfile, provider: "openai" },
					{ ...workflowRequest, sampling: { temperature: 1 } },
				),
			),
		).toBe(true);
		for (const [model, temperature] of [
			["kimi-k2.5", 0.6],
			["kimi-k2.6", 1],
		] as const) {
			const kimi = prepareWorkflow(
				{ ...workflowProfile, provider: "kimi", models: { daily: model } },
				workflowRequest,
			);
			expect(Either.isRight(kimi) && kimi.right.request.sampling).toEqual({
				temperature,
				topP: 0.95,
			});
			expect(
				Either.isLeft(
					prepareWorkflow(
						{ ...workflowProfile, provider: "kimi", models: { daily: model } },
						{ ...workflowRequest, sampling: { temperature: 0.2 } },
					),
				),
			).toBe(true);
		}
	});
	it("keeps every role selection independent under generated model choices", () =>
		fc.assert(
			fc.property(
				fc.string({ minLength: 1 }).filter((v) => v.trim() === v),
				(model) => {
					const models = { daily: "daily", routing: model };
					const prepared = prepareWorkflow(
						{ ...workflowProfile, models },
						{ ...workflowRequest, modelRole: "routing" },
					);
					expect(
						Either.isRight(prepared) && prepared.right.profile.modelId,
					).toBe(model);
					expect(models.daily).toBe("daily");
				},
			),
		));
	it("selects every configured model role and never invents a non-daily fallback", () => {
		for (const role of [
			"routing",
			"daily",
			"deepThink",
			"vision",
			"image",
			"video",
			"tts",
		] as const) {
			const selected = prepareWorkflow(workflowProfile, {
				...workflowRequest,
				modelRole: role,
			});
			expect(Either.isRight(selected) && selected.right.profile.modelId).toBe(
				workflowProfile.models?.[role],
			);
			if (role !== "daily")
				expect(
					Either.isLeft(
						prepareWorkflow(
							{ ...workflowProfile, models: {} },
							{ ...workflowRequest, modelRole: role },
						),
					),
				).toBe(true);
		}
	});

	it("ships 126 retained roles, all translations and six per-key defaults", () => {
		expect(ROLE_PRESETS).toHaveLength(126);
		for (const id of [65, 122, 124, 125])
			expect(Either.isLeft(selectRole(id, "en"))).toBe(true);
		for (const preset of ROLE_PRESETS)
			for (const locale of AiLocale.literals)
				expect(Either.isRight(selectRole(preset.id, locale))).toBe(true);
		expect(
			COPILOT_PRESETS.map((p) => [
				p.roleId,
				p.controls.thinking,
				p.controls.webSearch,
			]),
		).toEqual([
			[128, true, true],
			[6, false, true],
			[8, false, true],
			[93, false, true],
			[129, false, true],
			[84, false, true],
		]);
		expect(COPILOT_PRESETS[0]?.names.en).toBe("Content Writer");
	});
});
