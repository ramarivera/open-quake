import { Schema } from "effect";
import {
	MAX_PLAYLIST_ENTRIES,
	MAX_SOUND_VALUE_LENGTH,
	SoundEntry,
	SoundFade,
	SoundVolume,
} from "./soundboard-contracts.js";
import { isLocalSoundPath } from "./soundboard-invariants.js";

export const SoundOwner = Schema.Struct({
	profileId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
	keyCode: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64)),
});
export type SoundOwner = typeof SoundOwner.Type;
export const SoundPlaylist = Schema.Struct({
	revision: Schema.Int.pipe(Schema.nonNegative()),
	entries: Schema.Array(
		Schema.Struct({
			...SoundEntry.fields,
			fileId: Schema.String.pipe(
				Schema.minLength(1),
				Schema.maxLength(128),
				Schema.pattern(/^[A-Za-z0-9_-]+$/),
			),
		}),
	).pipe(
		Schema.minItems(1),
		Schema.maxItems(MAX_PLAYLIST_ENTRIES),
		Schema.filter(
			(entries) =>
				entries.reduce((length, entry) => length + entry.path.length, 0) <=
					MAX_SOUND_VALUE_LENGTH &&
				entries.every(
					(entry) =>
						isLocalSoundPath(entry.path) &&
						entry.path.toLowerCase().endsWith(".mp3"),
				),
		),
	),
	volume: SoundVolume,
	fade: SoundFade,
});
export type SoundPlaylist = typeof SoundPlaylist.Type;
export const SoundEndToken = Schema.Struct({
	playbackId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64)),
	generation: Schema.Int.pipe(Schema.nonNegative()),
});
export type SoundEndToken = typeof SoundEndToken.Type;
export const SoundSession = Schema.Struct({
	...SoundEndToken.fields,
	owner: SoundOwner,
	playlistRevision: Schema.Int.pipe(Schema.nonNegative()),
	trackIndex: Schema.Int.pipe(Schema.nonNegative()),
	state: Schema.Literal("loading", "playing", "paused", "stopped", "failed"),
	loopTrack: Schema.Boolean,
	positionMs: Schema.Number.pipe(Schema.finite(), Schema.nonNegative()),
	gain: Schema.Number.pipe(Schema.between(0, 1)),
	entries: Schema.Array(
		Schema.Struct({ fileId: Schema.String, status: SoundEntry.fields.status }),
	),
	errorCode: Schema.optional(Schema.String),
});
export type SoundSession = typeof SoundSession.Type;
export const soundOwnerKey = (owner: SoundOwner): string =>
	JSON.stringify([owner.profileId, owner.keyCode]);
