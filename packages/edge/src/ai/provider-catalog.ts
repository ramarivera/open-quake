import type { ProviderProfile } from "./ai-contracts.js";

/** Import metadata from AI-001/004–006/012/028. Never grants a capability. */
export const LEGACY_ENGINES = [
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
] as const;
export type CatalogProvider = (typeof LEGACY_ENGINES)[number];
export interface CatalogGroup {
	readonly id: string;
	readonly baseUrl: string;
	readonly models: readonly {
		readonly id: string;
		readonly maxTokens: number;
	}[];
}
const group = (
	id: string,
	baseUrl: string,
	models: readonly string[],
): CatalogGroup => ({
	id,
	baseUrl,
	models: models.map((id) => ({ id, maxTokens: 4096 })),
});
export const RETAINED_PROVIDER_CATALOG: readonly CatalogGroup[] = [
	group("openai", "https://api.openai.com/v1", [
		"gpt-5.1",
		"gpt-5.1-mini",
		"gpt-4o",
		"gpt-4o-mini",
		"gpt-4-turbo",
		"gpt-4",
		"gpt-3.5-turbo",
		"gpt-image-1.5",
		"sora-2",
		"gpt-4o-mini-tts",
		"tts-1",
		"tts-1-hd",
	]),
	group("qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", [
		"qwen3.6-plus",
		"qwen-plus",
		"qwen-max",
		"qwen-turbo",
		"qwen-72b-chat",
		"qwen1.5-32b-chat",
		"qwen1.5-72b-chat",
		"qwen1.5-110b-chat",
		"qwen2-1.5b-instruct",
		"qwen2-7b-instruct",
		"qwen2-72b-instruct",
		"qwq-32b",
		"qwen3.6-flash",
		"wanx2.1-t2i-turbo",
		"wan2.2-t2v-plus",
		"qwen2.5-72b-instruct",
		"qwen-omni-turbo",
		"qwen2.5-vl-72b-instruct",
	]),
	group("kimi", "https://api.moonshot.cn/v1", ["kimi-k2.5", "kimi-k2.6"]),
	group("deepseek", "https://api.deepseek.com", [
		"deepseek-v4-flash",
		"deepseek-v4-pro",
		"deepseek-chat",
		"deepseek-reasoner",
	]),
	group("groq", "https://api.groq.com/openai/v1", [
		"llama3-70b-8192",
		"llama3-8b-8192",
		"llama3-groq-70b-8192-tool-use-preview",
		"llama3-groq-8b-8192-tool-use-preview",
		"llama-3.1-8b-instant",
		"llama-3.1-70b-versatile",
		"llama-3.1-405b-reasoning",
		"gemma-7b-it",
		"gemma2-9b-it",
		"mixtral-8x7b-32768",
	]),
	group("zhipu", "https://open.bigmodel.cn/api/paas/v4", [
		"glm-3-turbo",
		"glm-4",
		"glm-4-0520",
		"glm-4-air",
		"glm-4-airx",
		"glm-4-flash",
	]),
	group("xfy", "https://spark-api.xf-yun.com", [
		"spark3.5-max",
		"spark4-ultra",
		"spark3.5",
		"spark-pro",
	]),
	group("volc", "https://ark.cn-beijing.volces.com/api/v3", []),
	group("coze", "https://api.coze.cn", []),
	group("custom", "", []),
];
const aliases: Readonly<Record<string, string>> = {
	QWen: "qwen",
	Qwen: "qwen",
	OpenAI: "openai",
	Kimi: "kimi",
	Moonshot: "kimi",
	moonshot: "kimi",
	DeepSeek: "deepseek",
	Groq: "groq",
	ZhiPu: "zhipu",
	HuoShan: "volc",
	Coze: "coze",
	Spark: "xfy",
	XYF: "xfy",
	StandardChat: "generic",
	CustomEngine: "custom",
	Custom: "custom",
	ArixoChat: "retired-account",
};
export const canonicalProvider = (provider: string): string =>
	aliases[provider] ?? provider;

/** Retain the compatible protocol used by saved Moonshot models without
 * applying the distinct K2.5/K2.6 sampling and thinking policy to them. */
export function inferenceProvider(provider: string, model: string): string {
	const canonical = canonicalProvider(provider);
	return canonical === "kimi" &&
		[
			"moonshot-v1-8k",
			"moonshot-v1-32k",
			"moonshot-v1-128k",
			"kimi-k2-turbo",
			"kimi-k2-thinking",
			"kimi-k2-thinking-turbo",
		].includes(model)
		? "generic"
		: canonical;
}
export function defaultModel(provider: string): string {
	switch (canonicalProvider(provider)) {
		case "qwen":
			return "qwen3.6-plus";
		case "kimi":
			return "kimi-k2.5";
		case "deepseek":
			return "deepseek-v4-flash";
		default:
			return "gpt-5.1";
	}
}
/** Fixes the vendor regression that forgot still-offered Qwen models. Import only. */
export function legacyModelProvider(model: string): string {
	const exact = RETAINED_PROVIDER_CATALOG.find((p) =>
		p.models.some((m) => m.id === model),
	);
	if (exact) return exact.id;
	if (model.startsWith("HuoShan-")) return "volc";
	if (model.startsWith("Coze-")) return "coze";
	if (model.startsWith("kimi-") || model.startsWith("moonshot-")) return "kimi";
	if (model.startsWith("deepseek-")) return "deepseek";
	return "custom";
}
export function migrateLegacySelection(input: {
	readonly engine?: number;
	readonly provider?: string;
	readonly modelId: string;
	readonly baseUrl?: string;
}) {
	const provider = input.provider
		? canonicalProvider(input.provider)
		: input.engine === undefined
			? legacyModelProvider(input.modelId)
			: (LEGACY_ENGINES[input.engine] ?? "custom");
	const inferred = legacyModelProvider(input.modelId);
	const families = ["openai", "qwen", "kimi", "deepseek"];
	const modelId =
		families.includes(provider) &&
		families.includes(inferred) &&
		provider !== inferred
			? defaultModel(provider)
			: input.modelId || defaultModel(provider);
	return {
		provider,
		modelId,
		baseUrl:
			input.baseUrl ||
			RETAINED_PROVIDER_CATALOG.find((p) => p.id === provider)?.baseUrl ||
			"",
	};
}
/** Existing order, endpoints, custom labels and model metadata win. No removals. */
export function mergeProviderCatalog(
	existing: readonly CatalogGroup[],
): readonly CatalogGroup[] {
	const merged = existing.map((p) => ({ ...p, models: [...p.models] }));
	for (const seed of RETAINED_PROVIDER_CATALOG) {
		const old = merged.find((p) => canonicalProvider(p.id) === seed.id);
		if (!old) merged.push({ ...seed, models: [...seed.models] });
		else
			for (const model of seed.models)
				if (!old.models.some((m) => m.id === model.id)) old.models.push(model);
	}
	return merged;
}
export function modelOptions(provider: string, custom: readonly string[] = []) {
	const models =
		RETAINED_PROVIDER_CATALOG.find((p) => p.id === canonicalProvider(provider))
			?.models ?? [];
	return [
		...new Set([...models.map((m) => m.id), ...custom].filter((m) => m.trim())),
	].map((id) => ({ id, label: id }));
}
export function localProviderListing(
	profiles: readonly ProviderProfile[],
	registered: readonly ProviderProfile["adapter"][],
) {
	return profiles.map((p) => ({
		id: p.id,
		provider: p.provider ?? "generic",
		modelId: p.modelId,
		available:
			registered.includes(p.adapter) &&
			(p.auth === "none" || Boolean(p.credentialRef)),
		directCapable:
			registered.includes(p.adapter) && p.capabilities.text === "supported",
		options: modelOptions(p.provider ?? "generic", [p.modelId]),
	}));
}
export function volcBaseUrl(entryMethod: "inference" | "agent"): string {
	return `https://ark.cn-beijing.volces.com/api/v3${entryMethod === "agent" ? "/bots" : ""}`;
}

export function legacyAssistantState(value: string) {
	switch (value) {
		case "assistantSessionStart":
			return { kind: "session", state: "start" } as const;
		case "assistantSessionEnd":
			return { kind: "session", state: "end" } as const;
		case "assistantSessionError":
			return { kind: "session", state: "error" } as const;
		case "assistantAnimationOnGoing":
			return { kind: "animation", state: "recording" } as const;
		case "assistantAnimationProcessing":
			return { kind: "animation", state: "processing" } as const;
		case "assistantAnimationIdle":
			return { kind: "animation", state: "idle" } as const;
		case "assistantTypeChat":
			return { kind: "type", state: "chat" } as const;
		case "assistantTypeKeyConfig":
			return { kind: "type", state: "keyConfig" } as const;
		default:
			return undefined;
	}
}

/** Pure JSON migration, called by profile import. Preserve all unrelated fields. */
export function migrateLegacyAiConfig(
	input: Readonly<Record<string, unknown>>,
) {
	const model = typeof input.modelType === "string" ? input.modelType : "";
	const provider =
		typeof input.aiEngineProvider === "string"
			? input.aiEngineProvider
			: undefined;
	const supportedModels = mergeLegacySupportedModels(input.supportedModels);
	const engine =
		typeof input.engineType === "number" ? input.engineType : undefined;
	if (!model && !provider && engine === undefined)
		return { ...input, supportedModels };
	const selected = migrateLegacySelection({
		modelId: model,
		...(engine === undefined ? {} : { engine }),
		...(provider ? { provider } : {}),
	});
	const chat =
		input.chat && typeof input.chat === "object" && !Array.isArray(input.chat)
			? input.chat
			: {};
	return {
		...input,
		supportedModels,
		modelType: selected.modelId,
		aiEngineProvider: selected.provider,
		chat: { ...chat, modelType: selected.modelId },
	};
}

const object = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
/** Preserve arbitrary imported JSON metadata, labels, order and user models. */
export function mergeLegacySupportedModels(input: unknown): readonly unknown[] {
	const groups: unknown[] = Array.isArray(input) ? [...input] : [];
	for (const seed of RETAINED_PROVIDER_CATALOG) {
		const index = groups.findIndex(
			(entry) =>
				object(entry) &&
				canonicalProvider(String(entry.value ?? entry.id)) === seed.id,
		);
		const old = groups[index];
		const models: unknown[] =
			object(old) && Array.isArray(old.models) ? [...old.models] : [];
		for (const model of seed.models)
			if (
				!models.some(
					(entry) => object(entry) && (entry.value ?? entry.id) === model.id,
				)
			)
				models.push({
					label: model.id,
					value: model.id,
					canModify: false,
					supportedFunctions: "chat",
				});
		if (index < 0) groups.push({ label: seed.id, value: seed.id, models });
		else if (object(old)) groups[index] = { ...old, models };
	}
	return groups;
}
