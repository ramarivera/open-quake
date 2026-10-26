import { Either } from "effect";
import type { InferenceRequest, ProviderProfile } from "./ai-contracts.js";
import {
	AiCapabilityUnsupported,
	AiConfigInvalid,
	type AiError,
} from "./ai-errors.js";
import { providerSamplingValid } from "./ai-sampling.js";
import type { ProviderOptions } from "./ai-workflow-contracts.js";

/** AI-008 source catalog, never used as a fallback or evidence of live availability.
 * Image/video entries in Kimi/DeepSeek tables used a different provider in DK-Suite;
 * selecting one here still requires an explicit capable profile. */
export const RECOVERED_WORKFLOW_MODELS = Object.freeze({
	qwen: Object.freeze({
		routing: "qwen3.6-flash",
		daily: "qwen3.6-plus",
		deepThink: "qwen3.6-plus",
		vision: "qwen3.6-flash",
		image: "wanx2.1-t2i-turbo",
		video: "wan2.2-t2v-plus",
		tts: "qwen-audio-3.1-tts-flash",
	}),
	openai: Object.freeze({
		routing: "gpt-5-mini",
		daily: "gpt-5.1",
		deepThink: "gpt-5.1",
		vision: "gpt-5.1",
		image: "gpt-image-1.5",
		video: "wan2.2-t2v-plus",
		tts: "gpt-4o-mini-tts",
	}),
	kimi: Object.freeze({
		routing: "kimi-k2.5",
		daily: "kimi-k2.5",
		deepThink: "kimi-k2.5",
		vision: "kimi-k2.5",
		image: "wanx2.1-t2i-turbo",
		video: "wan2.2-t2v-plus",
		tts: "gpt-4o-mini-tts",
	}),
	deepseek: Object.freeze({
		routing: "deepseek-v4-flash",
		daily: "deepseek-v4-flash",
		deepThink: "deepseek-v4-flash",
		vision: "deepseek-v4-flash",
		image: "wanx2.1-t2i-turbo",
		video: "wan2.2-t2v-plus",
		tts: "gpt-4o-mini-tts",
	}),
});

/** Recovered behavior, with rejection replacing silent stripping and fallback. AI-030–033. */
export const PROVIDER_QUIRKS = Object.freeze({
	openai:
		"max_completion_tokens; GPT-4o/4.1 sampling; other models default-only; gpt-5.1 thinking/search; gpt-5.1-mini low reasoning only",
	qwen: "temperature/top_p and enable_thinking/enable_search pass through",
	kimi: "k2.5 T=.6 top_p=.95 thinking disabled; k2.6 T=1 top_p=.95; unknown models unverified",
	deepseek:
		"text only; reject images instead of stripping; reasoning requires verified model",
	generic: "no inferred thinking or native search support",
});
export interface PreparedRequest {
	readonly profile: ProviderProfile;
	readonly request: InferenceRequest;
	readonly providerOptions: ProviderOptions;
}
/** Select a role model and validate provider controls before credentials or I/O.
 * Returned profile/request snapshots may carry provider-mandated defaults;
 * persisted profiles are never modified. */
export function prepareWorkflow(
	profile: ProviderProfile,
	request: InferenceRequest,
): Either.Either<PreparedRequest, AiError> {
	const role = request.modelRole ?? "daily";
	const modelId =
		profile.models?.[role] ?? (role === "daily" ? profile.modelId : undefined);
	if (!modelId) return Either.left(new AiConfigInvalid());
	// Classification has independent controls; daily defaults must not enable
	// reasoning or search on a separately selected routing model.
	const controls =
		role === "routing"
			? { ...request.controls }
			: { ...profile.controls, ...request.controls };
	const sampling = { ...request.sampling };
	let samplingLimits = profile.samplingLimits;
	const provider = profile.provider ?? "generic";
	const options: {
		-readonly [K in keyof ProviderOptions]: ProviderOptions[K];
	} = {};
	const invalid = () => Either.left(new AiConfigInvalid());
	if (controls.searchOptions && provider !== "qwen") return invalid();
	if (controls.searchQuery && provider !== "zhipu") return invalid();
	if (!providerSamplingValid({ provider, model: modelId, ...sampling }))
		return invalid();
	if (provider === "openai") {
		const reasoning = modelId === "gpt-5.1" || modelId === "gpt-5.1-mini";
		if ((controls.thinking || controls.reasoningEffort) && !reasoning)
			return invalid();
		if (
			modelId === "gpt-5.1-mini" &&
			(controls.thinking ||
				(controls.reasoningEffort && controls.reasoningEffort !== "low"))
		)
			return invalid();
		if (controls.webSearch && modelId !== "gpt-5.1") return invalid();
		if (
			controls.thinking === false &&
			controls.reasoningEffort &&
			controls.reasoningEffort !== "low"
		)
			return invalid();
		if (reasoning) {
			// GPT-5.1 defaults to no reasoning. Preserve absence separately from
			// an explicit disable; retain the recovered mini model's low policy.
			if (controls.reasoningEffort)
				options.reasoning_effort = controls.reasoningEffort;
			else if (controls.thinking) options.reasoning_effort = "high";
			else if (modelId === "gpt-5.1-mini") options.reasoning_effort = "low";
			else if (controls.thinking === false) options.reasoning_effort = "none";
		}
		if (controls.webSearch)
			options.web_search_options = { search_context_size: "medium" };
		if (sampling.maxOutputTokens !== undefined)
			options.max_completion_tokens = sampling.maxOutputTokens;
	} else if (provider === "qwen") {
		if (controls.reasoningEffort) return invalid();
		if (controls.searchOptions && !controls.webSearch) return invalid();
		if (controls.searchOptions) options.search_options = controls.searchOptions;
		if (controls.thinking !== undefined)
			options.enable_thinking = controls.thinking;
		if (controls.webSearch !== undefined)
			options.enable_search = controls.webSearch;
	} else if (provider === "zhipu") {
		if (controls.thinking || controls.reasoningEffort || controls.searchOptions)
			return invalid();
		if (controls.webSearch && request.tools?.length) return invalid();
		if (controls.webSearch)
			options.tools = [
				{
					type: "web_search",
					web_search: {
						enable: true,
						search_result: true,
						search_query:
							controls.searchQuery ??
							request.messages
								.filter((m) => m.role === "user")
								.flatMap((m) =>
									m.content.flatMap((p) => (p._tag === "text" ? [p.text] : [])),
								)
								.join("\n")
								.slice(-4096),
					},
				},
			];
	} else if (provider === "kimi") {
		if (controls.webSearch || controls.reasoningEffort) return invalid();
		if (modelId !== "kimi-k2.5" && modelId !== "kimi-k2.6") return invalid();
		const temperature = modelId === "kimi-k2.5" ? 0.6 : 1;
		if (modelId === "kimi-k2.5" && controls.thinking) return invalid();
		sampling.temperature = temperature;
		sampling.topP = 0.95;
		// Caller sampling was validated before preparation. Supply constraints for
		// mandatory provider values on this snapshot, retaining explicit limits.
		samplingLimits = {
			...samplingLimits,
			temperature: samplingLimits.temperature ?? {
				min: temperature,
				max: temperature,
			},
			topP: samplingLimits.topP ?? { min: 0.95, max: 0.95 },
		};
		if (modelId === "kimi-k2.5" || controls.thinking !== undefined)
			options.thinking = { type: controls.thinking ? "enabled" : "disabled" };
	} else if (provider === "deepseek") {
		if (
			role === "vision" ||
			request.requestedCapabilities.includes("images") ||
			request.messages.some((m) => m.content.some((p) => p._tag === "image"))
		)
			return Either.left(new AiCapabilityUnsupported("images"));
		if (controls.webSearch || controls.reasoningEffort || controls.thinking)
			return invalid();
	} else if (
		controls.thinking ||
		controls.webSearch ||
		controls.reasoningEffort
	)
		return invalid();
	return Either.right({
		profile: { ...profile, modelId, samplingLimits },
		request: { ...request, sampling, controls },
		providerOptions: options,
	});
}
