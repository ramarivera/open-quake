import { Either, Schema } from "effect";
import fc from "fast-check";
import { expect, test } from "vitest";
import { SoundPlaylist, soundOwnerKey } from "./playback-contracts.js";

test("owner identity can't alias through separators or Unicode", () => {
	fc.assert(
		fc.property(
			fc.tuple(fc.string(), fc.string()),
			fc.tuple(fc.string(), fc.string()),
			(a, b) => {
				expect(
					soundOwnerKey({ profileId: a[0], keyCode: a[1] }) ===
						soundOwnerKey({ profileId: b[0], keyCode: b[1] }),
				).toBe(a[0] === b[0] && a[1] === b[1]);
			},
		),
	);
});

test("playlists accept only bounded local MP3 configuration and opaque file IDs", () => {
	const valid = {
		revision: 1,
		entries: [{ fileId: "sound-0", path: "/music/a.mp3", status: "unchecked" }],
		volume: 0,
		fade: { mode: "none", durationMs: 0 },
	};
	expect(Schema.decodeUnknownSync(SoundPlaylist)(valid)).toEqual(valid);
	for (const path of [
		"https://example.invalid/a.mp3",
		"relative.mp3",
		"/music/a.wav",
		"\\\\server\\a.mp3",
	]) {
		expect(
			Either.isLeft(
				Schema.decodeUnknownEither(SoundPlaylist)({
					...valid,
					entries: [{ ...valid.entries[0], path }],
				}),
			),
		).toBe(true);
	}
	for (const fileId of ["", "/private/music.mp3", "x".repeat(129)])
		expect(
			Either.isLeft(
				Schema.decodeUnknownEither(SoundPlaylist)({
					...valid,
					entries: [{ ...valid.entries[0], fileId }],
				}),
			),
		).toBe(true);
	const large = {
		fileId: "a",
		path: `/${"x".repeat(32760)}.mp3`,
		status: "unchecked",
	};
	expect(
		Either.isLeft(
			Schema.decodeUnknownEither(SoundPlaylist)({
				...valid,
				entries: Array.from({ length: 33 }, () => large),
			}),
		),
	).toBe(true);
});
