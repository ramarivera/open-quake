import { ProfileId } from "../ai/ai-contracts.js";
import type { MeetingConfig } from "./meeting-contracts.js";
export const defaultMeetingConfig: MeetingConfig = {
	profileId: ProfileId.make("00000000-0000-4000-8000-000000000001"),
	asrProvider: "mock",
	asrModel: "qwen-audio-3.0-asr-flash-filetrans",
	minutesModel: "deterministic-text-v1",
	outputLanguage: "English",
	translationModel: "qwen3.5-livetranslate-flash-realtime",
	targetLanguage: "zh",
	microphoneId: "default",
	systemAudio: false,
	autoGenerate: true,
};
