import type { AssistantSettings } from "../../../../packages/device/src/profiles/assistant-contracts";
import {
	canonicalProvider,
	legacyModelProvider,
	supportsThinking,
	supportsWebSearch,
} from "../../../../packages/edge/src/ai/provider-catalog";

/** Follow the current General provider without carrying incompatible controls across providers. */
export function reconcileAssistantProvider(
	value: AssistantSettings,
	row: { readonly provider: string; readonly model: string } | undefined,
): AssistantSettings {
	if (value.modelRowId || !row) return value;
	const family = legacyModelProvider(value.modelId);
	const provider = canonicalProvider(row.provider);
	if (!["qwen", "kimi", "deepseek", "openai"].includes(provider)) return value;
	const modelId =
		value.modelId &&
		["openai", "qwen", "kimi", "deepseek"].includes(family) &&
		family !== provider
			? ""
			: value.modelId;
	const model = modelId || row.model;
	const thinking = value.thinking && supportsThinking(provider, model);
	const webSearch = value.webSearch && supportsWebSearch(provider, model);
	return modelId === value.modelId &&
		thinking === value.thinking &&
		webSearch === value.webSearch
		? value
		: { ...value, modelId, thinking, webSearch };
}
