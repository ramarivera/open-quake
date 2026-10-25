import { Schema } from "effect";
import { OPENAI_VOICES } from "../../../../packages/edge/src/ai/speech/speech-contracts";

const Workspace = Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9-]{1,128}$/));
const Region = Schema.Literal("cn-beijing", "ap-southeast-1");
export const SttSettings = Schema.Struct({
	workspace: Workspace,
	region: Region,
});
export const TtsSettings = Schema.Union(
	Schema.Struct({
		provider: Schema.Literal("openai"),
		language: Schema.String.pipe(Schema.maxLength(32)),
		voice: Schema.NonEmptyTrimmedString.pipe(
			Schema.maxLength(64),
			Schema.filter((voice) => OPENAI_VOICES.includes(voice)),
		),
	}),
	Schema.Struct({
		provider: Schema.Literal("dashscope"),
		workspace: Workspace,
		region: Region,
		language: Schema.String.pipe(Schema.maxLength(32)),
		voice: Schema.Literal("longanlingxin_v3.1"),
	}),
);
export const SpeechSettings = Schema.Struct({
	version: Schema.Literal(1),
	speakAnswers: Schema.Boolean,
	stt: Schema.optional(SttSettings),
	tts: Schema.optional(TtsSettings),
});
export type SpeechSettings = typeof SpeechSettings.Type;
export const SpeechSettingsRequest = Schema.Union(
	Schema.TaggedStruct("Get", {}),
	Schema.TaggedStruct("Save", {
		settings: SpeechSettings,
		sttKey: Schema.optional(
			Schema.String.pipe(Schema.minLength(1), Schema.maxLength(16384)),
		),
		ttsKey: Schema.optional(
			Schema.String.pipe(Schema.minLength(1), Schema.maxLength(16384)),
		),
	}),
);
export const SpeechSettingsView = Schema.Struct({
	settings: SpeechSettings,
	sttCredential: Schema.Boolean,
	ttsCredential: Schema.Boolean,
});
export type SpeechSettingsView = typeof SpeechSettingsView.Type;
export const SpeechSettingsReply = Schema.Union(
	Schema.TaggedStruct("success", { view: SpeechSettingsView }),
	Schema.TaggedStruct("rejected", { code: Schema.String }),
);
export type SpeechSettingsReply = typeof SpeechSettingsReply.Type;
export const SPEECH_SETTINGS_CHANNEL = "speech:settings";
export interface SpeechSettingsBridge {
	readonly request: (input: unknown) => Promise<unknown>;
}
declare global {
	interface Window {
		quakeSpeech?: SpeechSettingsBridge;
	}
}
