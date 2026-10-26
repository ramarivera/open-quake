import { AZURE_VOICES } from "./speech-catalog.js";
import {
	type SttProfile,
	type TtsProfile,
	validWorkspaceUrl,
} from "./speech-contracts.js";

const language = (value: string | undefined) =>
	!!value && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value);
const region = (value: string | undefined) =>
	!!value && /^[a-z][a-z0-9]{1,63}$/.test(value);
export function validStt(profile: SttProfile): boolean {
	switch (profile.provider) {
		case "dashscope":
			return (
				validWorkspaceUrl(profile.baseUrl, "wss:") &&
				profile.model === "qwen-audio-3.1-asr-flash-streaming"
			);
		case "openai":
			return (
				profile.baseUrl ===
					"wss://api.openai.com/v1/realtime?intent=transcription" &&
				profile.model === "gpt-transcribe" &&
				language(profile.language)
			);
		case "azure":
			return (
				profile.baseUrl === "azure:speech" &&
				profile.model === "azure-recognize-once" &&
				region(profile.region) &&
				!!AZURE_VOICES[profile.language ?? ""]
			);
		case "xfy":
			return (
				profile.baseUrl === "wss://iat-api.xfyun.cn/v2/iat" &&
				profile.model === "iat" &&
				["en_us", "zh_cn"].includes(profile.language ?? "")
			);
	}
}
export function validAdditionalTts(profile: TtsProfile): boolean {
	switch (profile.provider) {
		case "azure":
			return (
				profile.baseUrl === "azure:speech" &&
				profile.model === "azure-neural" &&
				profile.format === "pcm" &&
				region(profile.region) &&
				!!AZURE_VOICES[profile.language]?.includes(profile.voice)
			);
		case "xfy":
			return (
				profile.baseUrl === "wss://tts-api.xfyun.cn/v2/tts" &&
				profile.model === "xfy-tts" &&
				profile.voice === "aisxping" &&
				profile.format === "pcm"
			);
		case "qwen-realtime":
			return (
				/^wss:\/\/dashscope\.(?:aliyuncs\.com|(?:cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com)\/api-ws\/v1\/realtime\?model=qwen3-tts-flash-realtime$/.test(
					profile.baseUrl,
				) &&
				profile.model === "qwen3-tts-flash-realtime" &&
				profile.voice === "Cherry" &&
				profile.format === "pcm" &&
				profile.realtimeEnabled === true
			);
		default:
			return false;
	}
}
