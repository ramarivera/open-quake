import { describe, expect, it } from "@effect/vitest";
import { providerDefaults } from "../agents/provider-defaults.js";
import { workflowProfile } from "./ai-test-fixtures.js";
import { legacyDiagnosticCode } from "./legacy-diagnostics.js";
import {
	canonicalProvider,
	defaultModel,
	LEGACY_ENGINES,
	legacyAssistantState,
	legacyModelProvider,
	localProviderListing,
	mergeProviderCatalog,
	migrateLegacyAiConfig,
	migrateLegacySelection,
	modelOptions,
	RETAINED_PROVIDER_CATALOG,
	volcBaseUrl,
} from "./provider-catalog.js";

describe("providers retained catalog", () => {
	it("AI-001/006 retains every numeric engine disposition and explicit custom choices", () => {
		expect(LEGACY_ENGINES).toEqual([
			"xfy",
			"openai",
			"retired-account",
			"groq",
			"generic",
			"qwen",
			"zhipu",
			"custom",
			"volc",
			"coze",
			"kimi",
			"deepseek",
		]);
		LEGACY_ENGINES.forEach((provider, engine) => {
			expect(
				migrateLegacySelection({
					engine,
					modelId: "my-custom",
					baseUrl: "https://private.invalid/v1",
				}),
			).toEqual({
				provider,
				modelId: "my-custom",
				baseUrl: "https://private.invalid/v1",
			});
			expect(
				migrateLegacyAiConfig({ engineType: engine, modelType: "my-custom" }),
			).toMatchObject({
				aiEngineProvider: provider,
				modelType: "my-custom",
			});
		});
		for (const provider of RETAINED_PROVIDER_CATALOG)
			for (const model of provider.models)
				expect(legacyModelProvider(model.id)).toBe(provider.id);
		for (const [model, provider] of [
			["HuoShan-123", "volc"],
			["Coze-123", "coze"],
			["moonshot-mine", "kimi"],
			["deepseek-mine", "deepseek"],
			["unknown-custom", "custom"],
		])
			expect(legacyModelProvider(model ?? "")).toBe(provider);
	});
	it("AI-004/005/011/048 shares defaults, reconciles four families and preserves custom IDs", () => {
		for (const [provider, modelId] of [
			["QWen", "qwen3.6-plus"],
			["Kimi", "kimi-k2.5"],
			["DeepSeek", "deepseek-v4-flash"],
			["OpenAI", "gpt-5.1"],
			["unknown", "gpt-5.1"],
		]) {
			expect(defaultModel(provider ?? "")).toBe(modelId);
			expect(modelOptions(provider ?? "", ["custom-id"]).at(-1)?.id).toBe(
				"custom-id",
			);
		}
		for (const provider of ["openai", "qwen", "kimi", "deepseek"])
			for (const modelId of [
				"gpt-4o",
				"qwen-plus",
				"kimi-k2.5",
				"deepseek-chat",
			])
				expect(migrateLegacySelection({ provider, modelId }).modelId).toBe(
					legacyModelProvider(modelId) === provider
						? modelId
						: defaultModel(provider),
				);
		expect(
			migrateLegacySelection({ provider: "qwen", modelId: "my-model" }).modelId,
		).toBe("my-model");
		expect(modelOptions("deepseek").map((m) => m.id)).toEqual([
			"deepseek-v4-flash",
			"deepseek-v4-pro",
			"deepseek-chat",
			"deepseek-reasoner",
		]);
	});
	it("AI-012/028 production defaults append seeds without removing user metadata or restoring endpoints over a custom URL", () => {
		const existing = [
			{
				id: "qwen",
				baseUrl: "https://mine.invalid/v1",
				models: [{ id: "my-custom", maxTokens: 123 }],
			},
		];
		const merged = mergeProviderCatalog(existing);
		expect(merged[0]?.baseUrl).toBe("https://mine.invalid/v1");
		expect(merged[0]?.models[0]).toEqual({ id: "my-custom", maxTokens: 123 });
		expect(mergeProviderCatalog(merged)).toEqual(merged);
		expect(existing[0]?.models).toHaveLength(1);
		for (const seed of RETAINED_PROVIDER_CATALOG)
			for (const model of seed.models)
				expect(
					providerDefaults
						.find((p) => canonicalProvider(p.id) === seed.id)
						?.models.some((m) => m.id === model.id),
				).toBe(true);
		expect(migrateLegacySelection({ modelId: "glm-4" }).baseUrl).toBe(
			"https://open.bigmodel.cn/api/paas/v4",
		);
		expect(migrateLegacySelection({ modelId: "llama3-70b-8192" }).baseUrl).toBe(
			"https://api.groq.com/openai/v1",
		);
	});
	it("AI-017 empty/configured/unavailable listing has no credentials, endpoint or cloud fields", () => {
		expect(localProviderListing([], [])).toEqual([]);
		const listing = localProviderListing(
			[workflowProfile],
			["openai-compatible"],
		);
		expect(listing[0]).toMatchObject({
			available: true,
			directCapable: true,
			modelId: workflowProfile.modelId,
		});
		expect(localProviderListing([workflowProfile], [])[0]?.available).toBe(
			false,
		);
		expect(
			localProviderListing(
				[{ ...workflowProfile, credentialRef: undefined }],
				["openai-compatible"],
			)[0]?.available,
		).toBe(false);
		expect(JSON.stringify(listing)).not.toMatch(
			/credential|baseUrl|cloud|region/,
		);
	});
	it("AI-051 constructs both explicit Volc entry URLs", () => {
		expect(volcBaseUrl("inference")).toBe(
			"https://ark.cn-beijing.volces.com/api/v3",
		);
		expect(volcBaseUrl("agent")).toBe(
			"https://ark.cn-beijing.volces.com/api/v3/bots",
		);
	});
	it("MGMT-405 maps every session, animation and chat/keyConfig enum", () => {
		const states = [
			"assistantSessionStart",
			"assistantSessionEnd",
			"assistantSessionError",
			"assistantAnimationOnGoing",
			"assistantAnimationProcessing",
			"assistantAnimationIdle",
			"assistantTypeChat",
			"assistantTypeKeyConfig",
		];
		expect(states.map((state) => legacyAssistantState(state)?.state)).toEqual([
			"start",
			"end",
			"error",
			"recording",
			"processing",
			"idle",
			"chat",
			"keyConfig",
		]);
		expect(legacyAssistantState("execute generated code")).toBeUndefined();
	});
	it("AI-079 maps retained local diagnostics and excludes account, market and credit codes", () => {
		for (const [legacy, code] of [
			[1001, "VOICE.CAPTURE.RECORDER_UNAVAILABLE"],
			[2001, "CHAT.SESSION.BUSY"],
			[2004, "CHAT.RESPONSE.TIMEOUT"],
			[2006, "AI.PROVIDER.PROTOCOL_INVALID"],
			[1401, "AI.PROVIDER.AUTH_REQUIRED"],
			[1429, "AI.PROVIDER.RATE_LIMITED"],
			[3001, "AI.PROVIDER.OFFLINE"],
		] as const)
			expect(legacyDiagnosticCode(legacy)).toBe(code);
		for (const code of [3301, 4001, 4701, -1])
			expect(legacyDiagnosticCode(code)).toBeUndefined();
	});
});

it("AI-012 merges imported legacy catalogs idempotently without losing unknown metadata", () => {
	const input = {
		modelType: "deepseek-v4-pro",
		aiEngineProvider: "DeepSeek",
		supportedModels: [
			{
				label: "My Qwen",
				value: "Qwen",
				unknown: { keep: true },
				models: [
					{ label: "Mine", value: "custom", canModify: true, extra: [1, 2] },
				],
			},
			{ value: "other-provider", models: [{ value: "other" }] },
		],
	};
	const result = migrateLegacyAiConfig(input);
	expect(result.supportedModels[0]).toMatchObject({
		label: "My Qwen",
		value: "Qwen",
		unknown: { keep: true },
		models: expect.arrayContaining([
			{ label: "Mine", value: "custom", canModify: true, extra: [1, 2] },
		]),
	});
	expect(result.supportedModels[1]).toEqual(input.supportedModels[1]);
	expect(migrateLegacyAiConfig(result)).toEqual(result);
	expect(result).toMatchObject({
		modelType: "deepseek-v4-pro",
		aiEngineProvider: "deepseek",
		chat: { modelType: "deepseek-v4-pro" },
	});
});
