import { describe, expect, it } from "@effect/vitest";
import {
	Effect,
	Either,
	Fiber,
	Layer,
	Option,
	Stream,
	TestClock,
} from "effect";
import type { CompatibleAdapter } from "./adapters/adapter.js";
import { AiRepository } from "./ai-repository.js";
import type { VoiceRequest } from "./ai-router-contracts.js";
import {
	AiVoiceService,
	AiVoiceTargets,
	type VoiceDispatch,
} from "./ai-router-service.js";
import { AiProviderService } from "./ai-service.js";
import { workflowLayer, workflowProfile } from "./ai-test-fixtures.js";

const request: VoiceRequest = {
	requestId: "00000000-0000-4000-8000-000000000003",
	profileId: workflowProfile.id,
	mode: "auto",
	text: "voice transcript",
	homeAssistantEnabled: true,
};
const layer = (adapter: CompatibleAdapter, dispatches: VoiceDispatch[]) =>
	AiVoiceService.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(workflowLayer(adapter)),
		Layer.provide(
			Layer.succeed(AiVoiceTargets, {
				dispatch: (input) =>
					Effect.sync(() => {
						dispatches.push(input);
						return { operationId: input.request.requestId };
					}),
			}),
		),
	);
const decision = (action: string, extraData = "") =>
	JSON.stringify({
		userRequestAction: action,
		searchOptions: { shouldDoWebSearch: true, searchString: "query" },
		requestExtra: { friendlyResponse: "Working", extraData },
	});

describe("Auto key mode", () => {
	it.effect(
		"classifies independently of daily reasoning and preserves daily/deepThink effort",
		() =>
			Effect.gen(function* () {
				for (const reasoningEffort of ["medium", "high"] as const) {
					for (const routing of ["gpt-5-mini", "gpt-5.1-mini", "gpt-5.1"]) {
						const calls: Parameters<CompatibleAdapter["open"]>[0][] = [];
						const dispatches: VoiceDispatch[] = [];
						yield* Effect.gen(function* () {
							const repository = yield* AiRepository;
							const profile = {
								...workflowProfile,
								provider: "openai" as const,
								models: { daily: "gpt-5.1", deepThink: "gpt-5.1", routing },
								controls: { thinking: true, reasoningEffort, webSearch: true },
							};
							yield* repository.put(profile);
							expect(
								(yield* (yield* AiVoiceService).submit(request)).route,
							).toBe("normal");
							expect(dispatches).toHaveLength(1);
							expect(calls[0]?.profile.modelId).toBe(routing);
							expect(calls[0]?.request.controls).toEqual({
								thinking: false,
								webSearch: false,
							});
							expect(calls[0]?.providerOptions).toEqual({
								max_completion_tokens: 2048,
								...(routing === "gpt-5-mini"
									? {}
									: { reasoning_effort: "low" }),
							});
							const providers = yield* AiProviderService;
							for (const modelRole of ["daily", "deepThink"] as const) {
								const generation = yield* providers.generate({
									profileId: profile.id,
									modelRole,
									messages: [
										{
											role: "user",
											content: [{ _tag: "text", text: "hello" }],
										},
									],
									sampling: {},
									requestedCapabilities: [],
								});
								yield* Stream.runDrain(generation.events);
								expect(calls.at(-1)?.providerOptions).toEqual({
									reasoning_effort: reasoningEffort,
									web_search_options: { search_context_size: "medium" },
								});
							}
							const stored = yield* repository.get(profile.id);
							expect(Option.isSome(stored) && stored.value.controls).toEqual(
								profile.controls,
							);
						}).pipe(
							Effect.provide(
								layer(
									{
										open: (input) => {
											calls.push(input);
											return Effect.succeed(
												Stream.fromIterable([
													{
														_tag: "textDelta",
														textDelta: decision("standardChat"),
														kind: "generation",
													},
													{ _tag: "completed" },
												]),
											);
										},
									},
									dispatches,
								),
							),
						);
					}
				}
			}),
	);
	it.effect(
		"routes every recovered category and agent/shortcut/meeting extensions via the facade",
		() =>
			Effect.gen(function* () {
				for (const [action, extra, route] of [
					["standardChat", "", "normal"],
					["operatingComputer", "", "operatePC"],
					["generateConfiguration", "new config", "keyConfig"],
					["operatingEquipment", "", "operateEquipment"],
					["generateWallpaper", "picture", "pictureGeneration"],
					["generateWallpaper", "video", "videoGeneration"],
					["analysisUserData", "", "dataAnalysis"],
					["operateAgent", "", "agents"],
					["runShortcut", "", "shortcuts"],
					["meeting", "", "meetings"],
				] as const) {
					const calls: Parameters<CompatibleAdapter["open"]>[0][] = [];
					const dispatches: VoiceDispatch[] = [];
					yield* Effect.gen(function* () {
						yield* (yield* AiRepository).put(workflowProfile);
						const result = yield* (yield* AiVoiceService).submit(request);
						expect(result.route).toBe(route);
						expect(calls).toHaveLength(1);
						expect(dispatches).toHaveLength(1);
						expect(calls[0]?.profile.modelId).toBe("router");
						expect(calls[0]?.request.sampling.maxOutputTokens).toBe(2048);
						expect(
							Option.isSome(dispatches[0]?.decision ?? Option.none()) &&
								Option.getOrUndefined(dispatches[0]?.decision ?? Option.none())
									?.searchOptions.shouldDoWebSearch,
						).toBe(false);
					}).pipe(
						Effect.provide(
							layer(
								{
									open: (input) => {
										calls.push(input);
										return Effect.succeed(
											Stream.fromIterable([
												{
													_tag: "textDelta",
													textDelta: decision(action, extra),
													kind: "generation",
												},
												{ _tag: "completed" },
											]),
										);
									},
								},
								dispatches,
							),
						),
					);
				}
			}),
	);
	it.effect(
		"preserves explicit keys and caller-pinned Auto follow-ups without classifying",
		() => {
			const dispatches: VoiceDispatch[] = [];
			return Effect.gen(function* () {
				const service = yield* AiVoiceService;
				for (const route of [
					"normal",
					"agents",
					"shortcuts",
					"meetings",
					"operateEquipment",
				] as const) {
					expect(
						(yield* service.submit({ ...request, mode: route })).route,
					).toBe(route);
					expect(
						(yield* service.submit({ ...request, sessionRoute: route })).route,
					).toBe(route);
				}
				expect(dispatches).toHaveLength(10);
			}).pipe(
				Effect.provide(
					layer(
						{
							open: () =>
								Effect.die("explicit and follow-up modes must not classify"),
						},
						dispatches,
					),
				),
			);
		},
	);
	it.effect(
		"rejects expressions, malformed JSON, unknown categories and disabled HA",
		() =>
			Effect.gen(function* () {
				for (const text of [
					'(()=>{throw "executed"})()',
					decision("deleteEverything"),
					'{"userRequestAction":"standardChat","searchOptions":{"shouldDoWebSearch"false:}}',
					decision("operatingEquipment"),
					`${decision("standardChat")} trailing`,
					"answer instead of JSON",
				]) {
					const dispatches: VoiceDispatch[] = [];
					yield* Effect.gen(function* () {
						yield* (yield* AiRepository).put(workflowProfile);
						const result = yield* Effect.either(
							(yield* AiVoiceService).submit({
								...request,
								homeAssistantEnabled: false,
							}),
						);
						expect(Either.isLeft(result)).toBe(true);
						expect(dispatches).toEqual([]);
					}).pipe(
						Effect.provide(
							layer(
								{
									open: (input) => {
										const prompt = input.request.messages[0]?.content[0];
										expect(
											prompt?._tag === "text" && prompt.text,
										).not.toContain("operatingEquipment");
										return Effect.succeed(
											Stream.fromIterable([
												{
													_tag: "textDelta",
													textDelta: text,
													kind: "generation",
												},
												{ _tag: "completed" },
											]),
										);
									},
								},
								dispatches,
							),
						),
					);
				}
			}),
	);
	it.effect(
		"keeps opt-in search, bounds router output and cancels timed out classification",
		() =>
			Effect.gen(function* () {
				const dispatches: VoiceDispatch[] = [];
				yield* Effect.gen(function* () {
					yield* (yield* AiRepository).put({
						...workflowProfile,
						controls: { webSearch: true },
					});
					yield* (yield* AiVoiceService).submit(request);
					const selected = dispatches[0]?.decision;
					expect(
						selected &&
							Option.isSome(selected) &&
							selected.value.searchOptions.shouldDoWebSearch,
					).toBe(true);
				}).pipe(
					Effect.provide(
						layer(
							{
								open: () =>
									Effect.succeed(
										Stream.fromIterable([
											{
												_tag: "textDelta",
												textDelta: decision("standardChat"),
												kind: "generation",
											},
											{ _tag: "completed" },
										]),
									),
							},
							dispatches,
						),
					),
				);
				let signal: AbortSignal | undefined;
				yield* Effect.gen(function* () {
					yield* (yield* AiRepository).put(workflowProfile);
					const fiber = yield* (yield* AiVoiceService)
						.submit(request)
						.pipe(Effect.either, Effect.fork);
					yield* TestClock.adjust(300000);
					expect(Either.isLeft(yield* Fiber.join(fiber))).toBe(true);
					expect(signal?.aborted).toBe(true);
				}).pipe(
					Effect.provide(
						layer(
							{
								open: (input) => {
									signal = input.signal;
									return Effect.succeed(Stream.never);
								},
							},
							[],
						),
					),
				);
				yield* Effect.gen(function* () {
					yield* (yield* AiRepository).put(workflowProfile);
					const result = yield* Effect.either(
						(yield* AiVoiceService).submit(request),
					);
					expect(Either.isLeft(result) && result.left.code).toBe(
						"AI.PROVIDER.PROTOCOL_INVALID",
					);
				}).pipe(
					Effect.provide(
						layer(
							{
								open: () =>
									Effect.succeed(
										Stream.succeed({
											_tag: "textDelta",
											textDelta: "x".repeat(16385),
											kind: "generation",
										}),
									),
							},
							[],
						),
					),
				);
			}),
	);
});
