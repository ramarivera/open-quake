import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer, ManagedRuntime, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ClockConfigInvalid,
	ClockMediaTooShort,
	ClockMediaUnusable,
	ClockPersistenceFailed,
} from "../../shared/clock-errors";
import {
	ClockFiles,
	ClockFilesLive,
	ClockRoot,
	ClockStore,
	ClockVideoProbe,
	defaultClockRecord,
} from "./clock-store";

vi.mock("node:fs/promises", { spy: true });

const FILE = "/root/clock-v1/clock.json";

/** In-memory files with switchable write failure. */
function memory(initial: Record<string, string> = {}) {
	const files = new Map(Object.entries(initial));
	const existing = new Set<string>();
	const state = {
		failWrites: false,
		failReads: false,
		writes: 0,
		durationMs: 2000,
		probeFails: false,
	};
	const layer = Layer.succeed(ClockFiles, {
		read: (path) =>
			state.failReads
				? Effect.fail(
						ClockPersistenceFailed.fromCause(
							Object.assign(new Error("read"), { code: "EACCES" }),
						),
					)
				: Effect.succeed(Option.fromNullable(files.get(path))),
		writeAtomic: (path, text) =>
			state.failWrites
				? Effect.fail(
						ClockPersistenceFailed.fromCause(
							Object.assign(new Error("EACCES: /secret/path"), {
								code: "EACCES",
							}),
						),
					)
				: Effect.sync(() => {
						state.writes++;
						files.set(path, text);
					}),
		exists: (path) => Effect.succeed(existing.has(path)),
	});
	// One store per fixture, as main builds it once: staged candidates live in it.
	const runtime = ManagedRuntime.make(
		ClockStore.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(ClockRoot, "/root"),
					layer,
					Layer.succeed(ClockVideoProbe, {
						duration: () =>
							state.probeFails
								? Effect.fail(ClockMediaUnusable.fromCause(undefined))
								: Effect.succeed(state.durationMs),
					}),
				),
			),
		),
	);
	const run = <A, E>(effect: Effect.Effect<A, E, ClockStore>): Promise<A> =>
		runtime.runPromise(effect);
	const stored = (): unknown => JSON.parse(files.get(FILE) ?? "null");
	return { files, existing, state, run, stored };
}

const v04 = (background: unknown, extra: unknown[] = []) =>
	JSON.stringify({
		version: 1,
		revision: 7,
		keys: [
			{ keyCode: "2,2", config: { type: "cpu", actions: [] } },
			{
				keyCode: "1,1",
				childrenName: "dkDesktopClock",
				config: {
					type: "dkDesktopClock",
					actions: [
						{ type: "hourFormat", value: "12h" },
						{
							type: "clockStyle",
							value: { background, musicEnabled: true, updatedAt: 9 },
						},
						...extra,
					],
				},
			},
		],
	});

describe("clock store (WIDGETS-020/021/038)", () => {
	it("starts from DK-Suite's clock profile defaults without writing", async () => {
		const m = memory();
		const snapshot = await m.run(ClockStore.read());
		expect(snapshot).toEqual({
			hourFormat: "24h",
			revision: 0,
			keyCode: "1,1",
			mode: "theme",
			themeId: "season",
			showSeconds: false,
			media: {},
			recovered: false,
		});
		expect(m.state.writes).toBe(0);
		expect(defaultClockRecord.keys[0]?.config.actions[0]).toMatchObject({
			type: "clockStyle",
			value: { musicEnabled: true },
		});
	});

	it("patches only the theme and bumps the revision once", async () => {
		const m = memory({
			[FILE]: v04(
				{
					mode: "none",
					themeId: "season",
					themes: { aurora: { kind: "video", path: "/v/a.webm" } },
				},
				[{ type: "showSeconds", value: true }],
			),
		});
		const outcome = await m.run(ClockStore.setTheme("1,1", "cyber"));
		expect(outcome).toMatchObject({
			ok: true,
			snapshot: {
				revision: 8,
				mode: "theme",
				themeId: "cyber",
				showSeconds: true,
			},
		});
		expect(m.stored()).toEqual(
			JSON.parse(
				v04(
					{
						mode: "theme",
						themeId: "cyber",
						themes: { aurora: { kind: "video", path: "/v/a.webm" } },
					},
					[{ type: "showSeconds", value: true }],
				).replace('"revision":7', '"revision":8'),
			),
		);
		const again = await m.run(ClockStore.setTheme("1,1", "cyber"));
		expect(again).toMatchObject({ ok: true, snapshot: { revision: 8 } });
		expect(m.state.writes).toBe(1);
	});

	it("preserves metadata at every decoded level when saving", async () => {
		const record = {
			version: 1,
			revision: 7,
			extension: { keep: "root" },
			keys: [
				{
					keyCode: "2,2",
					title: "other",
					config: {
						type: "cpu",
						size: [2, 1],
						actions: [{ type: "custom", value: 3, stamp: 4 }],
					},
				},
				{
					keyCode: "1,1",
					title: "clock",
					icon: "keep",
					config: {
						type: "dkDesktopClock",
						supportTouchEffect: false,
						actions: [
							{
								type: "clockStyle",
								stamp: 5,
								value: {
									background: { mode: "theme", themeId: "season", themes: {} },
									extension: 6,
								},
							},
						],
					},
				},
			],
		};
		const m = memory({ [FILE]: JSON.stringify(record) });
		expect(await m.run(ClockStore.setTheme("1,1", "cyber"))).toMatchObject({
			ok: true,
		});
		expect(m.stored()).toEqual({
			...record,
			revision: 8,
			keys: [
				record.keys[0],
				{
					...record.keys[1],
					config: {
						...record.keys[1]?.config,
						actions: [
							{
								type: "clockStyle",
								stamp: 5,
								value: {
									background: { mode: "theme", themeId: "cyber", themes: {} },
									extension: 6,
								},
							},
						],
					},
				},
			],
		});
	});

	it("returns recovered defaults on a file read failure and allows saving", async () => {
		const m = memory();
		m.state.failReads = true;
		expect(await m.run(ClockStore.read())).toMatchObject({
			recovered: true,
			themeId: "season",
		});
		expect(await m.run(ClockStore.setTheme("1,1", "cyber"))).toMatchObject({
			ok: true,
			snapshot: { themeId: "cyber" },
		});
	});

	it("keeps revisions increasing when the settings file is deleted or corrupted", async () => {
		const m = memory();
		await m.run(ClockStore.setTheme("1,1", "cyber"));
		const saved = await m.run(ClockStore.setTheme("1,1", "anime"));
		const high = saved.ok ? saved.snapshot.revision : -1;
		expect(high).toBeGreaterThan(0);
		m.files.delete(FILE);
		const recovered = await m.run(ClockStore.read());
		expect(recovered.revision).toBeGreaterThanOrEqual(high);
		const after = await m.run(ClockStore.setTheme("1,1", "aurora"));
		expect(after).toMatchObject({ ok: true, snapshot: { themeId: "aurora" } });
		expect(after.ok && after.snapshot.revision).toBeGreaterThan(high);
		m.files.set(FILE, "{not json");
		expect((await m.run(ClockStore.read())).revision).toBeGreaterThan(high);
	});

	it.each(["image", "video"])(
		"migrates a legacy %s before switching themes",
		async (kind) => {
			const path = kind === "image" ? "/m/pic.png" : "/v/rain.mp4";
			const m = memory({ [FILE]: v04({ mode: kind, source: path }) });
			await m.run(ClockStore.setTheme("1,1", "cyber"));
			const back = await m.run(ClockStore.setTheme("1,1", "season"));
			expect(back).toMatchObject({
				ok: true,
				snapshot: { media: { season: { kind } } },
			});
			expect(await m.run(ClockStore.mediaPath({ theme: "season" }))).toEqual(
				Option.some(path),
			);
		},
	);

	it("rejects failed and nonfinite trusted probes without saving", async () => {
		const m = memory();
		m.existing.add("/m/loop.mov");
		for (const durationMs of [Number.NaN, Number.POSITIVE_INFINITY, 0]) {
			m.state.durationMs = durationMs;
			const staged = await m.run(
				ClockStore.stageMedia("aurora", "/m/loop.mov"),
			);
			if (staged._tag !== "candidate") throw new Error("expected candidate");
			const result = await m.run(
				Effect.either(ClockStore.commitMedia(staged.candidate.token, 5000)),
			);
			expect(Either.isLeft(result) && result.left.code).toBe(
				"QUAKE.CLOCK.MEDIA_UNUSABLE",
			);
		}
		m.state.probeFails = true;
		const staged = await m.run(ClockStore.stageMedia("aurora", "/m/loop.mov"));
		if (staged._tag !== "candidate") throw new Error("expected candidate");
		const result = await m.run(
			Effect.either(ClockStore.commitMedia(staged.candidate.token, 5000)),
		);
		expect(Either.isLeft(result) && result.left.code).toBe(
			"QUAKE.CLOCK.MEDIA_UNUSABLE",
		);
		expect(
			await m.run(ClockStore.mediaPath({ candidate: staged.candidate.token })),
		).toEqual(Option.none());
		expect(m.state.writes).toBe(0);
	});

	it("answers DK-Suite's reasons and keeps the file on failure", async () => {
		const m = memory({
			[FILE]: v04({ mode: "theme", themeId: "season", themes: {} }),
		});
		const before = m.files.get(FILE);
		expect(await m.run(ClockStore.setTheme("1,1", "neon"))).toEqual({
			ok: false,
			reason: "invalid-theme",
		});
		expect(await m.run(ClockStore.setTheme("x", "cyber"))).toEqual({
			ok: false,
			reason: "invalid-keycode",
		});
		expect(await m.run(ClockStore.setTheme("3,3", "cyber"))).toEqual({
			ok: false,
			reason: "cell-missing",
		});
		expect(await m.run(ClockStore.setTheme("2,2", "cyber"))).toEqual({
			ok: false,
			reason: "cell-not-clock",
		});
		m.state.failWrites = true;
		expect(await m.run(ClockStore.setTheme("1,1", "cyber"))).toEqual({
			ok: false,
			reason: "write-failed",
		});
		expect(m.files.get(FILE)).toBe(before);
	});

	it("reads an unreadable file as defaults and says so", async () => {
		const m = memory({ [FILE]: "{ not json" });
		expect(await m.run(ClockStore.read())).toMatchObject({
			recovered: true,
			themeId: "season",
		});
		const n = memory({ [FILE]: JSON.stringify({ version: 2 }) });
		expect(await n.run(ClockStore.read())).toMatchObject({ recovered: true });
	});

	it("switches None and back without losing custom slots", async () => {
		const m = memory({
			[FILE]: v04({
				mode: "theme",
				themeId: "aurora",
				themes: { aurora: { kind: "image", path: "/i/a.png" } },
			}),
		});
		m.existing.add("/i/a.png");
		expect(await m.run(ClockStore.setMode("none"))).toMatchObject({
			mode: "none",
			themeId: "aurora",
		});
		const back = await m.run(ClockStore.setMode("theme"));
		expect(back).toMatchObject({ mode: "theme", themeId: "aurora" });
		expect(back.media.aurora).toEqual({
			kind: "image",
			name: "a.png",
			url: "oq-clock-media://theme/aurora?r=9",
			available: true,
		});
		expect(JSON.stringify(back)).not.toContain("/i/");
	});

	it("migrates a v0.3 style when management edits it", async () => {
		const m = memory({ [FILE]: v04({ mode: "video", source: "/v/rain.mp4" }) });
		const snapshot = await m.run(ClockStore.setMode("theme"));
		expect(snapshot.media.season?.kind).toBe("video");
		expect(JSON.stringify(m.stored())).not.toContain('"source"');
	});

	it("stores the seconds option", async () => {
		const m = memory();
		expect(await m.run(ClockStore.setSeconds(true))).toMatchObject({
			showSeconds: true,
			revision: 1,
		});
		expect(await m.run(ClockStore.setSeconds(true))).toMatchObject({
			revision: 1,
		});
	});

	it("saves images at once and stages videos until their duration is known", async () => {
		const m = memory();
		m.existing.add("/m/pic.webp");
		m.existing.add("/m/loop.mov");
		const image = await m.run(ClockStore.stageMedia("cyber", "/m/pic.webp"));
		expect(image).toMatchObject({
			_tag: "saved",
			snapshot: { media: { cyber: { kind: "image", name: "pic.webp" } } },
		});
		const staged = await m.run(ClockStore.stageMedia("aurora", "/m/loop.mov"));
		if (staged._tag !== "candidate") throw new Error("expected a candidate");
		expect(staged.candidate).toMatchObject({
			themeId: "aurora",
			name: "loop.mov",
		});
		expect(
			await m.run(ClockStore.mediaPath({ candidate: staged.candidate.token })),
		).toEqual(Option.some("/m/loop.mov"));
		const committed = await m.run(
			ClockStore.commitMedia(staged.candidate.token, 2000),
		);
		expect(committed.media.aurora?.kind).toBe("video");
		expect(await m.run(ClockStore.mediaPath({ theme: "aurora" }))).toEqual(
			Option.some("/m/loop.mov"),
		);
		expect(await m.run(ClockStore.mediaPath({ theme: "season" }))).toEqual(
			Option.none(),
		);
		expect(await m.run(ClockStore.mediaPath({ theme: "../etc" }))).toEqual(
			Option.none(),
		);
	});

	it("refuses short videos, unknown tokens and unusable files with catalog errors", async () => {
		const m = memory();
		m.existing.add("/m/short.mp4");
		const staged = await m.run(ClockStore.stageMedia("anime", "/m/short.mp4"));
		if (staged._tag !== "candidate") throw new Error("expected a candidate");
		m.state.durationMs = 1999;
		const short = await m.run(
			Effect.either(ClockStore.commitMedia(staged.candidate.token, 5000)),
		);
		expect(Either.isLeft(short) && short.left).toBeInstanceOf(
			ClockMediaTooShort,
		);
		expect(Either.isLeft(short) && short.left.code).toBe(
			"QUAKE.CLOCK.MEDIA_TOO_SHORT",
		);
		const reused = await m.run(
			Effect.either(ClockStore.commitMedia(staged.candidate.token, 5000)),
		);
		expect(Either.isLeft(reused) && reused.left).toBeInstanceOf(
			ClockMediaUnusable,
		);
		const missing = await m.run(
			Effect.either(ClockStore.stageMedia("anime", "/m/gone.png")),
		);
		expect(Either.isLeft(missing) && missing.left.code).toBe(
			"QUAKE.CLOCK.MEDIA_UNUSABLE",
		);
		m.existing.add("/m/doc.pdf");
		const wrong = await m.run(
			Effect.either(ClockStore.stageMedia("anime", "/m/doc.pdf")),
		);
		expect(Either.isLeft(wrong) && wrong.left.message).toBe(
			"File missing or unusable; fell back to built-in",
		);
		expect(m.state.writes).toBe(0);
	});

	it("restores a theme's built-in background", async () => {
		const m = memory({
			[FILE]: v04({
				mode: "theme",
				themeId: "aurora",
				themes: { aurora: { kind: "image", path: "/i/a.png" } },
			}),
		});
		const snapshot = await m.run(ClockStore.restoreMedia("aurora"));
		expect(snapshot.media).toEqual({});
		expect(snapshot.themeId).toBe("aurora");
	});
});

describe("clock errors (open-quake-errors)", () => {
	it("keep the raw cause private and serialize only scrubbed diagnostics", () => {
		const cause = Object.assign(
			new Error("EACCES: /Users/someone/secret.json"),
			{ code: "EACCES" },
		);
		const error = ClockPersistenceFailed.fromCause(cause);
		expect(error._tag).toBe("ClockPersistenceFailed");
		expect(error.code).toBe("QUAKE.CLOCK.PERSISTENCE_FAILED");
		expect(error.originalCause).toBe(cause);
		expect(Object.keys(error)).not.toContain("originalCause");
		const json = JSON.stringify(error);
		expect(json).not.toContain("secret");
		expect(error.diagnosticCause).toEqual({
			name: "Error",
			sourceCode: "EACCES",
			truncated: true,
		});
		expect(ClockConfigInvalid.fromCause("x").diagnosticCause.name).toBe(
			"UnknownCause",
		);
	});
});

describe("clock files on disk", () => {
	let directory: string;
	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "open-quake-clock-"));
	});
	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});
	const run = <A, E>(effect: Effect.Effect<A, E, ClockStore>): Promise<A> =>
		ManagedRuntime.make(
			ClockStore.Default.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.succeed(ClockRoot, directory),
						ClockFilesLive,
						Layer.succeed(ClockVideoProbe, {
							duration: () =>
								Effect.fail(ClockMediaUnusable.fromCause(undefined)),
						}),
					),
				),
			),
		).runPromise(effect);

	it("writes atomically and leaves no temp files", async () => {
		await run(ClockStore.setTheme("1,1", "tactical"));
		const dir = join(directory, "clock-v1");
		expect(await readdir(dir)).toEqual(["clock.json"]);
		const saved: unknown = JSON.parse(
			await readFile(join(dir, "clock.json"), "utf8"),
		);
		expect(saved).toMatchObject({ version: 1, revision: 1 });
		expect((await run(ClockStore.read())).themeId).toBe("tactical");
	});

	it("recovers defaults when the real settings path is unreadable", async () => {
		await mkdir(join(directory, "clock-v1", "clock.json"), { recursive: true });
		expect(await run(ClockStore.read())).toMatchObject({
			recovered: true,
			themeId: "season",
		});
	});

	it("keeps a successful rename committed when cleanup fails", async () => {
		vi.mocked(rm).mockRejectedValueOnce(
			Object.assign(new Error("cleanup"), { code: "EACCES" }),
		);
		expect(await run(ClockStore.setTheme("1,1", "cyber"))).toMatchObject({
			ok: true,
			snapshot: { themeId: "cyber" },
		});
		expect((await run(ClockStore.read())).themeId).toBe("cyber");
	});

	it("keeps the original rename failure when cleanup also fails", async () => {
		vi.mocked(rename).mockRejectedValueOnce(
			Object.assign(new Error("rename"), { code: "ENOSPC" }),
		);
		vi.mocked(rm).mockRejectedValueOnce(
			Object.assign(new Error("cleanup"), { code: "EACCES" }),
		);
		expect(await run(ClockStore.setTheme("1,1", "cyber"))).toEqual({
			ok: false,
			reason: "write-failed",
		});
		expect((await run(ClockStore.read())).themeId).toBe("season");
	});

	it("reports real availability of custom files", async () => {
		const image = join(directory, "a.png");
		await writeFile(image, "x");
		await run(ClockStore.stageMedia("anime", image));
		expect((await run(ClockStore.read())).media.anime?.available).toBe(true);
		await rm(image);
		expect((await run(ClockStore.read())).media.anime?.available).toBe(false);
	});
});
