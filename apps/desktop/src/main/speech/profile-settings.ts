import { azureVoice } from "../../../../../packages/edge/src/ai/speech/speech-catalog";
import {
	PCM_24K,
	type SttProfile,
	speechInstructions,
	type TtsProfile,
} from "../../../../../packages/edge/src/ai/speech/speech-contracts";
import type {
	SpeechSettings,
	SttSettings,
	TtsSettings,
} from "../../shared/speech";

const host = (workspace: string, region: string) =>
	`${workspace}.${region}.maas.aliyuncs.com`;
export function sttConfiguration(
	config: SttSettings,
): Omit<SttProfile, "credentialRef" | "authGeneration"> {
	const provider = config.provider ?? "dashscope";
	if (config.provider === "openai")
		return {
			provider,
			baseUrl: "wss://api.openai.com/v1/realtime?intent=transcription",
			model: "gpt-transcribe",
			language: config.language,
			descriptor: PCM_24K,
		};
	if (config.provider === "azure")
		return {
			provider,
			baseUrl: "azure:speech",
			model: "azure-recognize-once",
			language: config.language,
			region: config.region ?? "eastasia",
			descriptor: PCM_24K,
		};
	if (config.provider === "xfy")
		return {
			provider,
			baseUrl: "wss://iat-api.xfyun.cn/v2/iat",
			model: "iat",
			language: config.language,
			descriptor: PCM_24K,
		};
	return {
		provider,
		baseUrl: `wss://${host(config.workspace, config.region)}`,
		model: "qwen-audio-3.1-asr-flash-streaming",
		descriptor: PCM_24K,
	};
}
export function ttsConfiguration(
	config: TtsSettings,
): Omit<TtsProfile, "credentialRef" | "authGeneration"> {
	const common = {
		provider: config.provider,
		voice: config.voice,
		language: config.language,
		instructions: speechInstructions(config.language),
		descriptor: PCM_24K,
	};
	switch (config.provider) {
		case "openai":
			return {
				...common,
				baseUrl: "https://api.openai.com/v1",
				model: "gpt-4o-mini-tts",
				format: "wav",
			};
		case "dashscope":
			return {
				...common,
				baseUrl: `https://${host(config.workspace, config.region)}`,
				model: "qwen-audio-3.1-tts-flash",
				format: "pcm",
			};
		case "azure":
			return {
				...common,
				voice: azureVoice(config.language, config.voice),
				region: config.region ?? "eastasia",
				baseUrl: "azure:speech",
				model: "azure-neural",
				format: "pcm",
			};
		case "xfy":
			return {
				...common,
				baseUrl: "wss://tts-api.xfyun.cn/v2/tts",
				model: "xfy-tts",
				format: "pcm",
			};
		case "qwen-realtime":
			return {
				...common,
				baseUrl:
					"wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime",
				model: "qwen3-tts-flash-realtime",
				format: "pcm",
				realtimeEnabled: true,
			};
	}
}
export function normalizeSpeechSettings(
	settings: SpeechSettings,
): SpeechSettings {
	return {
		...settings,
		...(settings.stt?.provider === "azure"
			? { stt: { ...settings.stt, region: settings.stt.region ?? "eastasia" } }
			: {}),
		...(settings.tts?.provider === "azure"
			? {
					tts: {
						...settings.tts,
						region: settings.tts.region ?? "eastasia",
						voice: azureVoice(settings.tts.language, settings.tts.voice),
					},
				}
			: {}),
	};
}
export function regionSuggestion(settings: SpeechSettings) {
	const country = settings.geographicSeed?.country;
	if (!country) return undefined;
	return country === "CN"
		? {
				provider: "dashscope" as const,
				liveTranslationModel: "qwen3.5-livetranslate-flash-realtime",
			}
		: {
				provider: "openai" as const,
				liveTranslationModel: "gpt-4o-transcribe",
			};
}
