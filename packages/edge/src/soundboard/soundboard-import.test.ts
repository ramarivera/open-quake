import { it } from "@effect/vitest";
import { Effect, Either, Fiber, Layer, Schema, TestClock } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
	MAX_PLAYLIST_ENTRIES,
	MAX_SOUND_VALUE_LENGTH,
	SoundImportPreview,
} from "./soundboard-contracts.js";
import {
	SoundboardConfigInvalid,
	SoundboardFileUnavailable,
} from "./soundboard-errors.js";
import { SoundboardImporter } from "./soundboard-import.js";
import {
	importSoundConfig,
	isLocalSoundPath,
	soundFade,
	soundPaths,
} from "./soundboard-invariants.js";
import { SoundboardFiles } from "./soundboard-ports.js";

const legacy = (patch: Record<string, unknown> = {}) => ({
	sound: '["/music/a.mp3","/music/b.MP3"]',
	audioAction: 0,
	audioFade: "0-0",
	volume: 100,
	...patch,
});
const ready = Layer.succeed(SoundboardFiles, {
	inspect: () => Effect.succeed("available" as const),
});
const run = (raw: unknown, files = ready) =>
	SoundboardImporter.preview(raw).pipe(
		Effect.provide(SoundboardImporter.Default.pipe(Layer.provide(files))),
	);
const parsed = (raw: unknown) => {
	const result = importSoundConfig(raw);
	if (Either.isLeft(result)) throw result.left;
	return result.right;
};

describe("soundboard review-only import", () => {
	test.each(["/music/song.mp3", "C:\\Music\\Song.MP3"])(
		"retains legacy single-file path %s without checking the filesystem",
		(path) => {
			const preview = parsed(legacy({ sound: path }));
			expect(preview.entries).toEqual([
				{ fileId: "sound-0", path, status: "unchecked" },
			]);
			expect(preview.state).toBe("needsConfiguration");
			expect(preview.issues).toEqual(["unverifiedFiles"]);
		},
	);
	test("preserves a single selected path exactly, including filename whitespace", async () => {
		const raw = "/music/a.mp3 ";
		const visited: string[] = [];
		const preview = await Effect.runPromise(
			run(
				legacy({ sound: raw }),
				Layer.succeed(SoundboardFiles, {
					inspect: (path) =>
						Effect.sync(() => {
							visited.push(path);
							return "available" as const;
						}),
				}),
			),
		);
		expect(visited).toEqual([raw]);
		expect(preview.entries[0]).toMatchObject({ path: raw, status: "notMp3" });
	});

	test("accepts the actual saved playAudio actions shape and rejects duplicate fields", async () => {
		const actions = Object.entries(legacy()).map(([type, value]) => ({
			type,
			value,
		}));
		const result = await Effect.runPromise(run({ type: "playAudio", actions }));
		expect(result.state).toBe("ready");
		expect(result.entries.map((entry) => entry.path)).toEqual([
			"/music/a.mp3",
			"/music/b.MP3",
		]);
		expect(
			Either.isLeft(
				importSoundConfig({
					type: "playAudio",
					actions: [actions[0], actions[0], actions[2], actions[3]],
				}),
			),
		).toBe(true);
		expect(
			Either.isLeft(
				importSoundConfig({ type: "playAudio", actions: actions.slice(0, 3) }),
			),
		).toBe(true);
	});

	test("preserves order, duplicates and unavailable/non-MP3 candidates instead of filtering", async () => {
		const visited: string[] = [];
		const preview = await Effect.runPromise(
			run(
				legacy({
					sound: [
						"/music/a.mp3",
						"/missing.mp3",
						"/folder",
						"/music/a.mp3",
						"/a.wav",
						"/pipe.mp3",
						"/denied.mp3",
					],
				}),
				Layer.succeed(SoundboardFiles, {
					inspect: (path) =>
						Effect.sync(() => {
							visited.push(path);
							return path === "/folder"
								? ("directory" as const)
								: path === "/missing.mp3"
									? ("missing" as const)
									: path === "/pipe.mp3"
										? ("notFile" as const)
										: path === "/denied.mp3"
											? ("unreadable" as const)
											: ("available" as const);
						}),
				}),
			),
		);
		expect(visited).toHaveLength(7);
		expect(preview.entries.map((entry) => entry.status)).toEqual([
			"available",
			"missing",
			"directory",
			"available",
			"notMp3",
			"notFile",
			"unreadable",
		]);
		expect(preview.entries.map((entry) => entry.path)).toEqual([
			"/music/a.mp3",
			"/missing.mp3",
			"/folder",
			"/music/a.mp3",
			"/a.wav",
			"/pipe.mp3",
			"/denied.mp3",
		]);
		expect(preview.state).toBe("ready");
	});
	test.each([
		[0, "PLAY_STOP"],
		[1, "PLAY_ADD"],
		[2, "PLAY_RESTART"],
		[3, "PLAY_LOOP"],
		[4, "STOP_ALL"],
		[5, "PLAY_PREV"],
		[6, "PLAY_NEXT"],
	])("decodes recovered action %s as %s", (value, operation) => {
		expect(parsed(legacy({ audioAction: value })).operation).toBe(operation);
	});
	test.each([[-1], [7], [1.5], ["0"], [undefined], [NaN], [Infinity]])(
		"doesn't guess unknown action %s",
		(audioAction) => {
			const preview = parsed(legacy({ audioAction }));
			expect(preview.entries).toHaveLength(2);
			expect(preview.operation).toBeUndefined();
			expect(preview.issues).toContain("operation");
		},
	);
	test.each([
		["0-500", "none"],
		["1-500", "in"],
		["2-500", "out"],
		["3-500", "toggle"],
	])("decodes recovered fade %s", (value, mode) => {
		expect(soundFade(value)).toEqual({ mode, durationMs: 500 });
	});
	test.each([
		"4-500",
		"3-10001",
		"3--1",
		"3-0.5",
		"3-500x",
		"3-",
		" 3-500",
		500,
		undefined,
	])("requires configuration for malformed fade %s", (audioFade) => {
		expect(parsed(legacy({ audioFade })).issues).toContain("fade");
	});
	test.each([-1, 101, NaN, Infinity, "50", undefined])(
		"rejects invalid gain %s without clamping",
		(volume) => {
			const preview = parsed(legacy({ volume }));
			expect(preview.volume).toBeUndefined();
			expect(preview.issues).toContain("volume");
		},
	);
	test("retains zero gain and both fade endpoints with schema round trips", async () => {
		for (const volume of [0, 0.5, 100])
			for (const audioFade of ["1-0", "3-10000"]) {
				const result = await Effect.runPromise(
					run(legacy({ volume, audioFade })),
				);
				expect(result.volume).toBe(volume);
				expect(
					Schema.decodeUnknownSync(SoundImportPreview)(
						Schema.encodeSync(SoundImportPreview)(result),
					),
				).toEqual(result);
			}
	});
	test.each([
		'["/music/a.mp3",',
		"{}",
		'"/music/a.mp3"',
		'["/music/a.mp3",42]',
		undefined,
		42,
	])(
		"rejects malformed playlist %s with catalog identity before file work",
		async (sound) => {
			let calls = 0;
			const result = await Effect.runPromise(
				Effect.either(
					run(
						legacy({ sound }),
						Layer.succeed(SoundboardFiles, {
							inspect: () =>
								Effect.sync(() => {
									calls++;
									return "available" as const;
								}),
						}),
					),
				),
			);
			expect(Either.isLeft(result) && result.left.code).toBe(
				"QUAKE.AUDIO.CONFIG_INVALID",
			);
			expect(calls).toBe(0);
		},
	);
	test("rejects remote, network, relative and control-character paths before any probe", async () => {
		let calls = 0;
		const paths = [
			"https://example.test/a.mp3",
			"file:///a.mp3",
			"a.mp3",
			"//host/a.mp3",
			"\\\\host\\a.mp3",
			"\\\\?\\C:\\a.mp3",
			"/bad\u0000.mp3",
		];
		const preview = await Effect.runPromise(
			run(
				legacy({ sound: paths }),
				Layer.succeed(SoundboardFiles, {
					inspect: () =>
						Effect.sync(() => {
							calls++;
							return "available" as const;
						}),
				}),
			),
		);
		expect(calls).toBe(0);
		expect(preview.entries.map((entry) => entry.status)).toEqual(
			paths.map(() => "invalidPath"),
		);
		expect(preview.state).toBe("needsConfiguration");
	});
	test("doesn't trust saved availability when previewing a normalized record again", async () => {
		const original = await Effect.runPromise(run(legacy()));
		const missing = await Effect.runPromise(
			run(
				original,
				Layer.succeed(SoundboardFiles, {
					inspect: () => Effect.succeed("missing" as const),
				}),
			),
		);
		expect(missing.state).toBe("needsConfiguration");
		expect(missing.entries.every((entry) => entry.status === "missing")).toBe(
			true,
		);
		expect(missing.issues).toContain("noAvailableFiles");
	});
	test("is idempotent on normalized previews while filesystem observations stay the same", async () => {
		const first = await Effect.runPromise(run(legacy()));
		expect(await Effect.runPromise(run(first))).toEqual(first);
	});
	test("keeps an empty preset unconfigured while STOP_ALL doesn't need files", async () => {
		expect(
			(await Effect.runPromise(run(legacy({ sound: "" })))).issues,
		).toEqual(["emptyPlaylist"]);
		expect(
			(await Effect.runPromise(run(legacy({ sound: "", audioAction: 4 }))))
				.state,
		).toBe("ready");
	});
	test("rejects oversized lists, strings, and paths before file access", () => {
		for (const sound of [
			Array(MAX_PLAYLIST_ENTRIES + 1).fill("/a.mp3"),
			"a".repeat(MAX_SOUND_VALUE_LENGTH + 1),
			Array(64).fill(`/${"a".repeat(20000)}.mp3`),
			[`/${"a".repeat(32768)}`],
		]) {
			expect(Either.isLeft(soundPaths(sound))).toBe(true);
		}
	});
	test("preserves failure cause privately and never serializes paths, tokens or raw messages", async () => {
		const cause = Object.assign(new Error("/private/song.mp3 Bearer secret"), {
			code: "EACCES",
		});
		const error = new SoundboardFileUnavailable(cause);
		expect(error.originalCause).toBe(cause);
		expect(JSON.stringify(error)).not.toMatch(
			/private|song|Bearer|secret|originalCause/,
		);
		expect(error.diagnosticCause.sourceCode).toBe("EACCES");
		const wire = Schema.decodeUnknownSync(SoundboardFileUnavailable)(
			JSON.parse(JSON.stringify(error)),
		);
		expect(wire.code).toBe(error.code);
		expect(wire.diagnosticCause).toEqual(error.diagnosticCause);
		const preview = await Effect.runPromise(
			run(
				legacy({ sound: "/private/song.mp3" }),
				Layer.succeed(SoundboardFiles, { inspect: () => Effect.fail(error) }),
			),
		);
		expect(preview.entries[0]?.status).toBe("unreadable");
		const configError = new SoundboardConfigInvalid(cause);
		expect(configError.originalCause).toBe(cause);
		expect(
			Schema.decodeUnknownSync(SoundboardConfigInvalid)(
				JSON.parse(JSON.stringify(configError)),
			).diagnosticCause,
		).toEqual(configError.diagnosticCause);
	});
	test("preserves arbitrary valid MP3 order and normalized import invariants", () =>
		fc.assert(
			fc.property(
				fc.array(fc.nat({ max: 100000 }), { minLength: 1, maxLength: 50 }),
				fc.integer({ min: 0, max: 6 }),
				fc.integer({ min: 0, max: 100 }),
				fc.integer({ min: 0, max: 10000 }),
				(ids, audioAction, volume, ms) => {
					const paths = ids.map((id) => `/music/${id}.mp3`);
					const first = parsed(
						legacy({
							sound: JSON.stringify(paths),
							audioAction,
							volume,
							audioFade: `3-${ms}`,
						}),
					);
					expect(first.entries.map((entry) => entry.path)).toEqual(paths);
					expect(first.fade?.durationMs).toBe(ms);
					expect(parsed(first)).toEqual(first);
					expect(paths.every(isLocalSoundPath)).toBe(true);
				},
			),
		));
	it.effect(
		"bounds an unresponsive metadata probe and publishes a truthful unreadable entry",
		() =>
			Effect.gen(function* () {
				const result = yield* Effect.fork(
					run(
						legacy({ sound: "/music/a.mp3" }),
						Layer.succeed(SoundboardFiles, { inspect: () => Effect.never }),
					),
				);
				yield* TestClock.adjust("2 seconds");
				const preview = yield* Fiber.join(result);
				expect(preview.entries[0]?.status).toBe("unreadable");
				expect(preview.issues).toEqual(["noAvailableFiles"]);
			}),
	);
});
