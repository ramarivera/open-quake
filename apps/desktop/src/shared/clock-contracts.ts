import { Schema } from "effect";
import { THEME_IDS, THEME_PATCH_REASONS } from "./clock-style";

export const CLOCK_REQUEST = "clock:request";
export const CLOCK_SNAPSHOT = "clock:snapshot";
/** App-private scheme for custom clock media; URLs carry a theme, never a path. */
export const CLOCK_MEDIA_SCHEME = "oq-clock-media";

export const ThemeIdSchema = Schema.Literal(...THEME_IDS);
const MediaKindSchema = Schema.Literal("image", "video");

/** What a renderer may know about a custom slot. */
export const ClockMediaView = Schema.Struct({
	kind: MediaKindSchema,
	/** File name only, for "▶ name" labels. */
	name: Schema.String,
	url: Schema.String.pipe(
		Schema.pattern(/^oq-clock-media:\/\/theme\/[a-z]+\?r=\d+$/),
	),
	available: Schema.Boolean,
});
export type ClockMediaView = typeof ClockMediaView.Type;

export const ClockSnapshot = Schema.Struct({
	revision: Schema.Int.pipe(Schema.nonNegative()),
	keyCode: Schema.String,
	mode: Schema.Literal("none", "theme"),
	themeId: ThemeIdSchema,
	showSeconds: Schema.Boolean,
	media: Schema.Struct({
		season: Schema.optionalWith(ClockMediaView, { exact: true }),
		cyber: Schema.optionalWith(ClockMediaView, { exact: true }),
		anime: Schema.optionalWith(ClockMediaView, { exact: true }),
		tactical: Schema.optionalWith(ClockMediaView, { exact: true }),
		aurora: Schema.optionalWith(ClockMediaView, { exact: true }),
	}),
	/** The stored file was unreadable or invalid and defaults are shown. */
	recovered: Schema.Boolean,
});
export type ClockSnapshot = typeof ClockSnapshot.Type;

export const ClockCommand = Schema.Union(
	Schema.TaggedStruct("read", {}),
	// DK-Suite `clock-style:set-theme {keyCode, themeId}`; validated by the patch.
	Schema.TaggedStruct("setTheme", {
		keyCode: Schema.String,
		themeId: Schema.String,
	}),
	Schema.TaggedStruct("setMode", { mode: Schema.Literal("none", "theme") }),
	Schema.TaggedStruct("setSeconds", { showSeconds: Schema.Boolean }),
	Schema.TaggedStruct("chooseMedia", { themeId: ThemeIdSchema }),
	Schema.TaggedStruct("commitMedia", {
		token: Schema.String,
		durationMs: Schema.Finite,
	}),
	Schema.TaggedStruct("restoreMedia", { themeId: ThemeIdSchema }),
);
export type ClockCommand = typeof ClockCommand.Type;
/** The strip may read and switch themes; everything else is management-only. */
export const PANEL_CLOCK_COMMANDS: readonly ClockCommand["_tag"][] = [
	"read",
	"setTheme",
];

export const ClockReply = Schema.Union(
	Schema.TaggedStruct("success", { snapshot: ClockSnapshot }),
	/** A picked video waits for its duration probe before it is saved. */
	Schema.TaggedStruct("candidate", {
		themeId: ThemeIdSchema,
		token: Schema.String,
		url: Schema.String.pipe(
			Schema.pattern(/^oq-clock-media:\/\/candidate\/[a-f0-9]+$/),
		),
		name: Schema.String,
	}),
	Schema.TaggedStruct("failure", {
		code: Schema.Literal(
			"QUAKE.CLOCK.CONFIG_INVALID",
			"QUAKE.CLOCK.PERSISTENCE_FAILED",
			"QUAKE.CLOCK.MEDIA_UNUSABLE",
			"QUAKE.CLOCK.MEDIA_TOO_SHORT",
		),
		message: Schema.String,
		reason: Schema.optionalWith(Schema.Literal(...THEME_PATCH_REASONS), {
			exact: true,
		}),
	}),
);
export type ClockReply = typeof ClockReply.Type;

export interface ClockBridge {
	request(command: ClockCommand): Promise<unknown>;
	onSnapshot(callback: (snapshot: unknown) => void): () => void;
}
declare global {
	interface Window {
		quakeClock?: ClockBridge;
	}
}
