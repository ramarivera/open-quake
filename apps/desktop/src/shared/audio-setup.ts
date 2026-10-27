import { Schema } from "effect";

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
	),
});
export type AudioSetupReply = typeof AudioSetupReply.Type;
export const BLACKHOLE_WARNING =
	"This installs the BlackHole virtual audio driver on macOS. macOS Installer will request an administrator password. To capture system audio while hearing it, you must choose a Multi-Output Device containing your speakers and BlackHole in Audio MIDI Setup. Changing the system output affects audio routing and may change volume controls. open-quake won't change routing for you. Only continue with a BlackHole package downloaded from existential.audio.";
