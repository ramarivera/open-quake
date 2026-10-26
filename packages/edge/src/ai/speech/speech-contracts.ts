import { Schema } from "effect";
import { CredentialRef } from "../ai-contracts.js";

export const AudioDescriptor = Schema.Struct({
	codec: Schema.Literal("pcm-s16le"),
	sampleRate: Schema.Literal(24000),
	channels: Schema.Literal(1),
	bitsPerSample: Schema.Literal(16),
});
export type AudioDescriptor = typeof AudioDescriptor.Type;
export const PCM_24K: AudioDescriptor = Object.freeze({
	codec: "pcm-s16le",
	sampleRate: 24000,
	channels: 1,
	bitsPerSample: 16,
});
const identity = {
	credentialRef: CredentialRef,
	authGeneration: Schema.Int.pipe(Schema.nonNegative()),
};
export const TtsProfile = Schema.Struct({
	...identity,
	provider: Schema.Literal(
		"openai",
		"dashscope",
		"azure",
		"xfy",
		"qwen-realtime",
	),
	baseUrl: Schema.String,
	model: Schema.NonEmptyTrimmedString,
	voice: Schema.NonEmptyTrimmedString,
	region: Schema.optional(Schema.String),
	realtimeEnabled: Schema.optional(Schema.Boolean),
	language: Schema.String,
	instructions: Schema.NonEmptyTrimmedString,
	format: Schema.Literal("wav", "pcm"),
	descriptor: AudioDescriptor,
});
export type TtsProfile = typeof TtsProfile.Type;
export const SttProfile = Schema.Struct({
	...identity,
	provider: Schema.Literal("dashscope", "openai", "azure", "xfy"),
	baseUrl: Schema.String,
	model: Schema.NonEmptyTrimmedString,
	language: Schema.optional(Schema.String),
	region: Schema.optional(Schema.String),
	descriptor: AudioDescriptor,
});
export type SttProfile = typeof SttProfile.Type;
export interface GeneratedAudio {
	readonly bytes: Uint8Array;
	readonly descriptor: AudioDescriptor;
	readonly durationMs: number;
	readonly format: "wav" | "pcm";
	readonly provenance: "generation";
}
export function speechInstructions(locale: string): string {
	const languages: Readonly<Record<string, string>> = {
		zh: "Chinese",
		en: "English",
		ja: "Japanese",
		ko: "Korean",
		de: "German",
		fr: "French",
		es: "Spanish",
		it: "Italian",
	};
	const language =
		languages[locale.toLowerCase().split(/[-_]/)[0] ?? ""] ?? "English";
	return `Tone should be stable and calm with a medium speaking speed. Speak in ${language} and avoid mixing multiple languages unless explicitly requested.`;
}
export const OPENAI_TTS_SHUTDOWN = Date.parse("2027-01-06T00:00:00Z");
export const OPENAI_VOICES = [
	"alloy",
	"ash",
	"ballad",
	"coral",
	"echo",
	"fable",
	"nova",
	"onyx",
	"sage",
	"shimmer",
	"verse",
	"marin",
	"cedar",
];
/** Workspace and region are explicit. A global DashScope/gateway URL cannot pass. */
export function validWorkspaceUrl(
	input: string,
	protocol: "https:" | "wss:",
): boolean {
	return new RegExp(
		`^${protocol}//[a-zA-Z0-9-]+\\.(cn-beijing|ap-southeast-1)\\.maas\\.aliyuncs\\.com/?$`,
	).test(input);
}
