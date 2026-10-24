import { Schema } from "effect";
import { ProfileId } from "./ai-contracts.js";

export const VoiceMode = Schema.Literal(
	"normal",
	"agents",
	"operateEquipment",
	"shortcuts",
	"meetings",
	"operatePC",
	"keyConfig",
	"pictureGeneration",
	"videoGeneration",
	"dataAnalysis",
);
export type VoiceMode = typeof VoiceMode.Type;
export const VoiceKeyMode = Schema.Union(Schema.Literal("auto"), VoiceMode);
export type VoiceKeyMode = typeof VoiceKeyMode.Type;
const bounded = Schema.String.pipe(Schema.maxLength(4000));
export const IntentDecision = Schema.Struct({
	userRequestAction: Schema.Literal(
		"operatingComputer",
		"generateConfiguration",
		"operatingEquipment",
		"generateWallpaper",
		"analysisUserData",
		"standardChat",
		"operateAgent",
		"runShortcut",
		"meeting",
	),
	searchOptions: Schema.Struct({
		shouldDoWebSearch: Schema.Boolean,
		searchString: bounded,
	}),
	requestExtra: Schema.optional(
		Schema.Struct({
			friendlyResponse: bounded,
			extraData: Schema.Literal(
				"",
				"new config",
				"modify config",
				"picture",
				"video",
			),
		}),
	),
});
export type IntentDecision = typeof IntentDecision.Type;
export const VoiceRequest = Schema.Struct({
	requestId: Schema.UUID,
	profileId: ProfileId,
	mode: VoiceKeyMode,
	text: Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(64000)),
	homeAssistantEnabled: Schema.Boolean,
	sessionRoute: Schema.optional(VoiceMode),
});
export type VoiceRequest = typeof VoiceRequest.Type;
export const VOICE_MODE_LABELS = Object.freeze({ auto: "Auto" });
