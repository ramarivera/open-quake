import { Either } from "effect";
import type { InferenceRequest, ProviderProfile } from "./ai-contracts.js";
import {
	AiCapabilityUnsupported,
	AiConfigInvalid,
	type AiError,
} from "./ai-errors.js";
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
		"max_completion_tokens; reject sampling; gpt-5.1 thinking/search; gpt-5.1-mini low reasoning only",
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
export function prepareWorkflow(
	profile: ProviderProfile,
	request: InferenceRequest,
): Either.Either<PreparedRequest, AiError> {
	const role = request.modelRole ?? "daily";
	const modelId =
		profile.models?.[role] ?? (role === "daily" ? profile.modelId : undefined);
	if (!modelId) return Either.left(new AiConfigInvalid());
	const controls = { ...profile.controls, ...request.controls };
	const sampling = { ...request.sampling };
	const provider = profile.provider ?? "generic";
	const options: {
		-readonly [K in keyof ProviderOptions]: ProviderOptions[K];
	} = {};
	const invalid = () => Either.left(new AiConfigInvalid());
	if (provider === "openai") {
		if (sampling.temperature !== undefined || sampling.topP !== undefined)
			return invalid();
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
		if (reasoning)
			options.reasoning_effort =
				controls.reasoningEffort ?? (controls.thinking ? "high" : "low");
		if (controls.webSearch)
			options.web_search_options = { search_context_size: "medium" };
		if (sampling.maxOutputTokens !== undefined)
			options.max_completion_tokens = sampling.maxOutputTokens;
	} else if (provider === "qwen") {
		if (controls.reasoningEffort) return invalid();
		if (controls.thinking !== undefined)
			options.enable_thinking = controls.thinking;
		if (controls.webSearch !== undefined)
			options.enable_search = controls.webSearch;
	} else if (provider === "kimi") {
		if (controls.webSearch || controls.reasoningEffort) return invalid();
		if (modelId !== "kimi-k2.5" && modelId !== "kimi-k2.6") return invalid();
		const temperature = modelId === "kimi-k2.5" ? 0.6 : 1;
		if (
			(sampling.temperature !== undefined &&
				sampling.temperature !== temperature) ||
			(sampling.topP !== undefined && sampling.topP !== 0.95) ||
			(modelId === "kimi-k2.5" && controls.thinking)
		)
			return invalid();
		sampling.temperature = temperature;
		sampling.topP = 0.95;
		if (modelId === "kimi-k2.5" || controls.thinking !== undefined)
			options.thinking = { type: controls.thinking ? "enabled" : "disabled" };
	} else if (provider === "deepseek") {
		if (
			request.requestedCapabilities.includes("images") ||
			request.messages.some((m) => m.content.some((p) => p._tag === "image"))
		)
			return Either.left(new AiCapabilityUnsupported("images"));
		if (
			controls.webSearch ||
			controls.reasoningEffort ||
			controls.thinking !== undefined
		)
			return invalid();
	} else if (
		controls.thinking ||
		controls.webSearch ||
		controls.reasoningEffort
	)
		return invalid();
	return Either.right({
		profile: { ...profile, modelId },
		request: { ...request, sampling, controls },
		providerOptions: options,
	});
}
