import { AlertVolume, FirmwareIdentity } from "@open-quake/protocol";
import { Schema } from "effect";

export const HardwarePreferences = Schema.Struct({
	knobLedAlwaysOn: Schema.Boolean,
	buzzerEnabled: Schema.Boolean,
	alertVolume: AlertVolume,
	/** Last acknowledged values. Never evidence of this session's live state. */
	mic: Schema.optional(Schema.Boolean),
	luminance: Schema.optional(Schema.Uint8),
});
export type HardwarePreferences = typeof HardwarePreferences.Type;
export const defaultHardwarePreferences: HardwarePreferences = {
	knobLedAlwaysOn: true,
	buzzerEnabled: true,
	alertVolume: 84,
};
export const InputMode = Schema.Literal("device", "host");
export type InputMode = typeof InputMode.Type;
export const HardwareSnapshot = Schema.Struct({
	serial: Schema.NonEmptyString,
	available: Schema.Boolean,
	preferenceStatus: Schema.Literal("saved", "pending", "failed"),
	errorCode: Schema.optional(Schema.String),
	session: Schema.NonEmptyString,
	preferences: HardwarePreferences,
	inputMode: InputMode,
	recovered: Schema.optional(
		Schema.Struct({ mic: Schema.Boolean, luminance: Schema.Uint8 }),
	),
	pendingStateSync: Schema.optional(Schema.Boolean),
	stateSyncSuccess: Schema.optional(Schema.Boolean),
	mic: Schema.optional(Schema.Boolean),
	luminance: Schema.optional(Schema.Uint8),
	firmware: Schema.optional(FirmwareIdentity),
});
export type HardwareSnapshot = typeof HardwareSnapshot.Type;
export const ToneName = Schema.Literal(
	"start",
	"end",
	"error",
	"busy",
	"preview",
	"firework",
	"success",
);
export type ToneName = typeof ToneName.Type;
export const SliderPosition = Schema.Int.pipe(Schema.between(0, 96));

export const ToneSequence = Schema.Array(
	Schema.Tuple(AlertVolume, Schema.Int.pipe(Schema.between(0, 60000))),
).pipe(
	Schema.minItems(1),
	Schema.maxItems(64),
	Schema.filter(
		(steps) =>
			steps.reduce((total, [, duration]) => total + duration, 0) <= 120000,
	),
);
export type ToneSequence = typeof ToneSequence.Type;
