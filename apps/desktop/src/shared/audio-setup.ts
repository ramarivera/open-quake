import { Schema } from "effect";
import strings from "./audio-setup-strings.json";

export const AUDIO_SETUP_CHANNEL = "meetings:audio-setup";
export const AudioSetupRequest = Schema.Struct({
	action: Schema.Literal("status", "install"),
});
export const AudioSetupReply = Schema.Struct({
	platform: Schema.String,
	state: Schema.Literal(
		"available",
		"unsupported",
		"mock",
		"cancelled",
		"opened",
		"failed",
		"storage-full",
	),
});
export type AudioSetupReply = typeof AudioSetupReply.Type;
/** Shared native and renderer copy; unsupported product locales use English. */
export function audioSetupText(locale: string) {
	return locale === "de" ? strings.de : strings.en;
}
