import { Either, Schema } from "effect";
import {
	MAX_PLAYLIST_ENTRIES,
	MAX_SOUND_VALUE_LENGTH,
	type SoundEntry,
	type SoundFade,
	SoundImportPreview,
	type SoundOperation,
	SoundVolume,
} from "./soundboard-contracts.js";
import { SoundboardConfigInvalid } from "./soundboard-errors.js";

const operations: readonly SoundOperation[] = [
	"PLAY_STOP",
	"PLAY_ADD",
	"PLAY_RESTART",
	"PLAY_LOOP",
	"STOP_ALL",
	"PLAY_PREV",
	"PLAY_NEXT",
];
const fadeModes = ["none", "in", "out", "toggle"] as const;
const PathList = Schema.Array(Schema.String.pipe(Schema.maxLength(32768))).pipe(
	Schema.maxItems(MAX_PLAYLIST_ENTRIES),
);
const LegacyKey = Schema.Struct({
	type: Schema.Literal("playAudio"),
	actions: Schema.Array(
		Schema.Struct({
			type: Schema.Literal("sound", "audioAction", "audioFade", "volume"),
			value: Schema.Unknown,
		}),
	).pipe(Schema.maxItems(4)),
});
const Legacy = Schema.Struct({
	sound: Schema.Unknown,
	audioAction: Schema.Unknown,
	audioFade: Schema.Unknown,
	volume: Schema.Unknown,
});

/** Local absolute paths only. No URLs, network shares, device paths or relative resolution. */
export function isLocalSoundPath(path: string): boolean {
	return (
		path.length > 0 &&
		path.length <= 32768 &&
		!Array.from(path).some((character) => character.charCodeAt(0) < 32) &&
		!path.startsWith("//") &&
		(path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path))
	);
}
export function soundFade(value: unknown): SoundFade | undefined {
	if (typeof value !== "string") return;
	const match = /^([0-3])-([0-9]{1,5})$/.exec(value);
	if (!match) return;
	const mode = fadeModes[Number(match[1])];
	const durationMs = Number(match[2]);
	return mode && durationMs <= 10000 ? { mode, durationMs } : undefined;
}

/** Parse once at the migration boundary. Order and duplicate entries are intentional. */
export function soundPaths(
	raw: unknown,
): Either.Either<readonly string[], SoundboardConfigInvalid> {
	let parsed: unknown = raw;
	if (typeof raw === "string") {
		if (raw.length > MAX_SOUND_VALUE_LENGTH)
			return Either.left(new SoundboardConfigInvalid());
		const value = raw.trim();
		if (value === "") parsed = [];
		else if (
			value.startsWith("[") ||
			value.startsWith("{") ||
			value.startsWith('"')
		) {
			try {
				parsed = JSON.parse(value);
			} catch (cause) {
				return Either.left(new SoundboardConfigInvalid(cause));
			}
		} else parsed = [value];
	}
	const paths = Schema.decodeUnknownEither(PathList)(parsed);
	if (Either.isLeft(paths))
		return Either.left(new SoundboardConfigInvalid(paths.left));
	if (
		paths.right.reduce((length, path) => length + path.length, 0) >
		MAX_SOUND_VALUE_LENGTH
	)
		return Either.left(new SoundboardConfigInvalid());
	return Either.right(paths.right);
}

export function classifyImport(
	entries: readonly SoundEntry[],
	controls: Pick<SoundImportPreview, "operation" | "fade" | "volume">,
): SoundImportPreview {
	const issues: SoundImportPreview["issues"][number][] = [];
	if (controls.operation === undefined) issues.push("operation");
	if (controls.fade === undefined) issues.push("fade");
	if (controls.volume === undefined) issues.push("volume");
	if (!entries.length && controls.operation !== "STOP_ALL")
		issues.push("emptyPlaylist");
	else if (
		entries.length &&
		controls.operation !== "STOP_ALL" &&
		entries.every(
			(entry) => entry.status !== "available" && entry.status !== "unchecked",
		)
	)
		issues.push("noAvailableFiles");
	if (entries.some((entry) => entry.status === "unchecked"))
		issues.push("unverifiedFiles");
	if (entries.some((entry) => entry.status === "invalidPath"))
		issues.push("invalidPath");
	return {
		version: 1,
		state: issues.length ? "needsConfiguration" : "ready",
		entries,
		operation: controls.operation,
		fade: controls.fade,
		volume: controls.volume,
		issues,
	};
}

export function importSoundConfig(
	raw: unknown,
): Either.Either<SoundImportPreview, SoundboardConfigInvalid> {
	const normalized = Schema.decodeUnknownEither(SoundImportPreview)(raw);
	if (Either.isRight(normalized)) {
		const { entries, operation, fade, volume } = normalized.right;
		if (
			entries.reduce((length, entry) => length + entry.path.length, 0) >
			MAX_SOUND_VALUE_LENGTH
		)
			return Either.left(new SoundboardConfigInvalid());
		return Either.right(
			classifyImport(
				entries.map((entry, index) => ({
					fileId: `sound-${index}`,
					path: entry.path,
					status: isLocalSoundPath(entry.path) ? "unchecked" : "invalidPath",
				})),
				{ operation, fade, volume },
			),
		);
	}
	const key = Schema.decodeUnknownEither(LegacyKey)(raw);
	if (
		Either.isRight(key) &&
		(key.right.actions.length !== 4 ||
			new Set(key.right.actions.map((action) => action.type)).size !== 4)
	)
		return Either.left(new SoundboardConfigInvalid());
	const legacy = Schema.decodeUnknownEither(Legacy)(
		Either.isRight(key)
			? Object.fromEntries(
					key.right.actions.map((action) => [action.type, action.value]),
				)
			: raw,
	);
	if (Either.isLeft(legacy))
		return Either.left(new SoundboardConfigInvalid(legacy.left));
	const source = legacy.right;
	const paths = soundPaths(source.sound);
	if (Either.isLeft(paths)) return Either.left(paths.left);
	const operation =
		typeof source.audioAction === "number" &&
		Number.isInteger(source.audioAction)
			? operations[source.audioAction]
			: undefined;
	const fade = soundFade(source.audioFade);
	const volume = Schema.decodeUnknownOption(SoundVolume)(source.volume);
	return Either.right(
		classifyImport(
			paths.right.map((path, index) => ({
				fileId: `sound-${index}`,
				path,
				status: isLocalSoundPath(path) ? "unchecked" : "invalidPath",
			})),
			{
				...(operation === undefined ? {} : { operation }),
				...(fade === undefined ? {} : { fade }),
				...(volume._tag === "None" ? {} : { volume: volume.value }),
			},
		),
	);
}
