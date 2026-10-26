import { Schema } from "effect";
import { OPENAI_VOICES } from "../../../../packages/edge/src/ai/speech/speech-contracts";

const Workspace = Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9-]{1,128}$/));
const Region = Schema.Literal("cn-beijing", "ap-southeast-1");
export const MicrophoneIdentity = Schema.Struct({
	deviceId: Schema.String.pipe(Schema.maxLength(1024)),
	label: Schema.String.pipe(Schema.maxLength(1024)),
	groupId: Schema.String.pipe(Schema.maxLength(1024)),
});
export type MicrophoneIdentity = typeof MicrophoneIdentity.Type;
/** Legacy values are accepted only at the settings boundary. */
export const MicrophonePreference = Schema.Union(
	Schema.String.pipe(Schema.maxLength(1024)),
	Schema.Struct({
		deviceId: Schema.String.pipe(Schema.maxLength(1024)),
		label: Schema.optional(Schema.String.pipe(Schema.maxLength(1024))),
		groupId: Schema.optional(Schema.String.pipe(Schema.maxLength(1024))),
	}),
);
export const normalizeMicrophone = (
	raw: unknown,
): MicrophoneIdentity | undefined => {
	const clean = (value: unknown) =>
		typeof value === "string" ? value.trim().slice(0, 1024) : "";
	if (typeof raw === "string")
		return clean(raw)
			? { deviceId: clean(raw), label: "", groupId: "" }
			: undefined;
	if (!raw || typeof raw !== "object" || !("deviceId" in raw)) return undefined;
	const deviceId = clean(raw.deviceId);
	return deviceId
		? {
				deviceId,
				label: "label" in raw ? clean(raw.label) : "",
				groupId: "groupId" in raw ? clean(raw.groupId) : "",
			}
		: undefined;
};
/** Never disambiguate by position or fall back from a saved physical input. */
export function recoverMicrophone(
	saved: MicrophoneIdentity | undefined,
	inputs: readonly MicrophoneIdentity[],
): MicrophoneIdentity | undefined {
	if (!saved || saved.deviceId === "default")
		return (
			inputs.find((d) => d.deviceId === "default") ??
			(saved ? undefined : inputs[0])
		);
	const exact = inputs.find((d) => d.deviceId === saved.deviceId);
	if (exact) return exact;
	if (saved.groupId) {
		const group = inputs.filter((d) => d.groupId === saved.groupId);
		if (group.length === 1) return group[0];
		const labeled = group.filter((d) => saved.label && d.label === saved.label);
		return labeled.length === 1 ? labeled[0] : undefined;
	}
	const labeled = inputs.filter((d) => saved.label && d.label === saved.label);
	return labeled.length === 1 ? labeled[0] : undefined;
}
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
	defaultMic: Schema.optional(MicrophonePreference),
	stt: Schema.optional(SttSettings),
	tts: Schema.optional(TtsSettings),
});
export type SpeechSettings = typeof SpeechSettings.Type;
export const SpeechSettingsRequest = Schema.Union(
	Schema.TaggedStruct("Get", {}),
	Schema.TaggedStruct("SelectMicrophone", { microphone: MicrophonePreference }),
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
