import { Schema } from "effect";
import { KnobSession } from "../knob-contracts.js";

const id = Schema.NonEmptyTrimmedString;
export const Thumbnail = Schema.Union(
	Schema.TaggedStruct("missing", {}),
	Schema.TaggedStruct("ready", {
		dataUrl: Schema.String.pipe(
			Schema.pattern(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/),
			Schema.maxLength(2_000_000),
		),
	}),
);
export const MenuProfile = Schema.Struct({
	id,
	name: id,
	colorful: Schema.Boolean,
	thumbnail: Thumbnail,
});
export type MenuProfile = typeof MenuProfile.Type;
export const FocusKey = Schema.Struct({
	keyCode: id,
	kind: Schema.Literal("vol", "luminance", "brightness", "hotkey"),
	visible: Schema.Boolean,
	supportKnob: Schema.Boolean,
	size: Schema.optional(
		Schema.Tuple(
			Schema.Int.pipe(Schema.between(1, 8)),
			Schema.Int.pipe(Schema.between(1, 2)),
		),
	),
});
export type FocusKey = typeof FocusKey.Type;
export const KnobModelContext = Schema.Struct({
	session: KnobSession,
	profiles: Schema.Array(MenuProfile).pipe(
		Schema.filter(
			(profiles) => new Set(profiles.map((p) => p.id)).size === profiles.length,
		),
	),
	keys: Schema.Array(FocusKey),
	player: Schema.Boolean,
}).pipe(
	Schema.filter((c) => c.profiles.some((p) => p.id === c.session.profileId)),
);
export type KnobModelContext = typeof KnobModelContext.Type;
export const VolumeReading = Schema.Struct({
	level: Schema.Int.pipe(Schema.between(0, 100)),
	muted: Schema.Boolean,
});
export type VolumeReading = typeof VolumeReading.Type;
export const KnobModelSnapshot = Schema.Struct({
	context: KnobModelContext,
	revision: Schema.Int.pipe(Schema.nonNegative()),
	selector: Schema.Struct({
		mode: Schema.Literal("closed", "ring", "picker"),
		index: Schema.Int.pipe(Schema.nonNegative()),
		page: Schema.Int.pipe(Schema.nonNegative()),
		progress: Schema.Number.pipe(Schema.between(0, 1)),
		ringVisible: Schema.Boolean,
		direction: Schema.Literal(-1, 1),
	}),
	focus: Schema.Union(
		Schema.TaggedStruct("none", {}),
		Schema.TaggedStruct("tile", { keyCode: id, angle: Schema.Number }),
	),
	volume: Schema.Struct({
		phase: Schema.Literal("inactive", "activating", "active", "unavailable"),
		...VolumeReading.fields,
	}),
	/** Catalog identity only; native diagnostics never cross the preload. */
	notice: Schema.String,
});
export type KnobModelSnapshot = typeof KnobModelSnapshot.Type;
const session = { sessionId: id };
export const KnobModelInput = Schema.Union(
	Schema.TaggedStruct("Rotate", { ...session, delta: Schema.Literal(-1, 1) }),
	Schema.TaggedStruct("Key", {
		...session,
		code: Schema.Literal(1, 2, 5, 255),
	}),
	Schema.TaggedStruct("TapTile", { ...session, keyCode: id }),
	Schema.TaggedStruct("ToggleVolume", session),
	Schema.TaggedStruct("Page", { ...session, delta: Schema.Literal(-1, 1) }),
	Schema.TaggedStruct("Select", { ...session, profileId: id }),
	Schema.TaggedStruct("Dismiss", session),
	Schema.TaggedStruct("Disconnect", session),
	Schema.TaggedStruct("ObservedVolume", {
		...session,
		...VolumeReading.fields,
	}),
);
export type KnobModelInput = typeof KnobModelInput.Type;
export interface KnobVoiceInput {
	readonly action: "holdStart" | "release" | "interrupt" | "cancel";
	readonly session: KnobSession;
	readonly generation: number;
}

export const KNOB_TIMING = {
	ringCommit: 200,
	ringHide: 3000,
	pickerCommit: 5000,
	pickerRingHide: 1200,
	progress: 100,
	visualCoalesce: 16,
	volumeGuard: 500,
	volumeProbe: 5000,
} as const;
