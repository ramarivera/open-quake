import { Schema } from "effect";

export const MAX_PLAYLIST_ENTRIES = 1024;
export const MAX_SOUND_VALUE_LENGTH = 1024 * 1024;
export const SoundOperation = Schema.Literal(
	"PLAY_STOP",
	"PLAY_ADD",
	"PLAY_RESTART",
	"PLAY_LOOP",
	"STOP_ALL",
	"PLAY_PREV",
	"PLAY_NEXT",
);
export type SoundOperation = typeof SoundOperation.Type;
export const SoundFade = Schema.Struct({
	mode: Schema.Literal("none", "in", "out", "toggle"),
	durationMs: Schema.Int.pipe(Schema.between(0, 10000)),
});
export type SoundFade = typeof SoundFade.Type;
export const SoundVolume = Schema.Number.pipe(Schema.between(0, 100));
export const SoundEntryStatus = Schema.Literal(
	"unchecked",
	"available",
	"missing",
	"unreadable",
	"directory",
	"notFile",
	"notMp3",
	"invalidPath",
);
export const SoundEntry = Schema.Struct({
	fileId: Schema.String,
	/** Private local configuration. Never include paths in diagnostics or logs. */
	path: Schema.String.pipe(Schema.maxLength(32768)),
	status: SoundEntryStatus,
});
export type SoundEntry = typeof SoundEntry.Type;
export const SoundImportIssue = Schema.Literal(
	"operation",
	"fade",
	"volume",
	"emptyPlaylist",
	"noAvailableFiles",
	"invalidPath",
	"unverifiedFiles",
);
/** Review-only. This record cannot acquire audio output or execute an action. */
export const SoundImportPreview = Schema.Struct({
	version: Schema.Literal(1),
	state: Schema.Literal("ready", "needsConfiguration"),
	entries: Schema.Array(SoundEntry).pipe(Schema.maxItems(MAX_PLAYLIST_ENTRIES)),
	operation: Schema.optional(SoundOperation),
	fade: Schema.optional(SoundFade),
	volume: Schema.optional(SoundVolume),
	issues: Schema.Array(SoundImportIssue),
});
export type SoundImportPreview = typeof SoundImportPreview.Type;
