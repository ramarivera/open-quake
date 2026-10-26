import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { SoundboardFileUnavailable } from "../../../../../packages/edge/src/soundboard/soundboard-errors.js";
import { SoundboardImporter } from "../../../../../packages/edge/src/soundboard/soundboard-import.js";
import { SoundboardFiles } from "../../../../../packages/edge/src/soundboard/soundboard-ports.js";
import { createDesktopDiagnostics } from "../diagnostics/index.js";
import { safeError } from "../diagnostics/privacy.js";
import { SoundboardFilesLive } from "./files.js";

const owned: string[] = [];
afterEach(async () => {
	await Promise.all(
		owned.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});
const legacy = (sound: unknown) => ({
	sound,
	audioAction: 6,
	audioFade: "3-500",
	volume: 50,
});
describe("read-only local sound import", () => {
	it("observes actual files, missing paths, directories and unsupported extensions without decoding or playback", async () => {
		const directory = await mkdtemp(join(tmpdir(), "oq-sound-import-"));
		owned.push(directory);
		const mp3 = join(directory, "not-decoded.mp3");
		const wav = join(directory, "other.wav");
		const folder = join(directory, "directory.mp3");
		await writeFile(mp3, "intentionally not MP3 data");
		await writeFile(wav, "also not audio");
		await mkdir(folder);
		const layer = SoundboardImporter.Default.pipe(
			Layer.provide(SoundboardFilesLive),
		);
		const result = await Effect.runPromise(
			SoundboardImporter.preview(
				legacy([mp3, folder, join(directory, "missing.mp3"), wav, mp3]),
			).pipe(Effect.provide(layer)),
		);
		expect(result.entries.map((entry) => entry.status)).toEqual([
			"available",
			"directory",
			"missing",
			"notMp3",
			"available",
		]);
		expect(result.operation).toBe("PLAY_NEXT");
		expect(result.state).toBe("ready");
		await rm(mp3);
		const rescanned = await Effect.runPromise(
			SoundboardImporter.preview(result).pipe(Effect.provide(layer)),
		);
		expect(rescanned.entries[0]?.status).toBe("missing");
		expect(rescanned.entries[4]?.status).toBe("missing");
		expect(rescanned.state).toBe("needsConfiguration");
	});
	it("refuses foreign-host relative resolution as well as URLs before stat", async () => {
		const foreign =
			process.platform === "win32" ? "/music/a.mp3" : "C:\\music\\a.mp3";
		for (const path of [
			foreign,
			"https://example.test/a.mp3",
			"relative.mp3",
		]) {
			const exit = await Effect.runPromise(
				Effect.gen(function* () {
					const files = yield* SoundboardFiles;
					return yield* Effect.either(files.inspect(path));
				}).pipe(Effect.provide(SoundboardFilesLive)),
			);
			expect(Either.isLeft(exit) && exit.left.code).toBe(
				"QUAKE.AUDIO.FILE_UNAVAILABLE",
			);
		}
	});
	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
		"keeps real permission denial private and visible as unreadable",
		async () => {
			const directory = await mkdtemp(join(tmpdir(), "oq-sound-permission-"));
			owned.push(directory);
			const path = join(directory, "denied.mp3");
			await writeFile(path, "fixture");
			await chmod(path, 0);
			try {
				const result = await Effect.runPromise(
					Effect.gen(function* () {
						const files = yield* SoundboardFiles;
						return yield* Effect.either(files.inspect(path));
					}).pipe(Effect.provide(SoundboardFilesLive)),
				);
				expect(
					Either.isLeft(result) && result.left.originalCause instanceof Error,
				).toBe(true);
				if (Either.isLeft(result)) {
					expect(result.left.diagnosticCause.sourceCode).toBe("EACCES");
					expect(JSON.stringify(result.left)).not.toContain(path);
				}
			} finally {
				await chmod(path, 0o600);
			}
		},
	);
	it("retains the catalog fault and child span in the real diagnostics pipeline, without a local path", async () => {
		const directory = await mkdtemp(join(tmpdir(), "oq-sound-diagnostics-"));
		owned.push(directory);
		const diagnostics = createDesktopDiagnostics({ directory });
		const source = Object.assign(
			new Error("/private/music.mp3 Bearer secret"),
			{ code: "EACCES" },
		);
		const failure = new SoundboardFileUnavailable(source);
		expect(safeError(failure)).toMatchObject({
			_tag: "SoundboardFileUnavailable",
			code: "QUAKE.AUDIO.FILE_UNAVAILABLE",
			cause: { sourceCode: "EACCES" },
		});
		const runtime = ManagedRuntime.make(
			SoundboardImporter.Default.pipe(
				Layer.provide(
					Layer.succeed(SoundboardFiles, {
						inspect: Effect.fn("SoundboardFiles.inspect")(() =>
							Effect.fail(failure),
						),
					}),
				),
				Layer.provideMerge(diagnostics.layer),
			),
		);
		try {
			const preview = await runtime.runPromise(
				diagnostics.instrument(
					SoundboardImporter.preview(legacy("/private/music.mp3")),
					"app.background",
				),
			);
			expect(preview.entries[0]?.status).toBe("unreadable");
		} finally {
			await runtime.dispose();
			await diagnostics.close();
		}
		const { readdir, readFile } = await import("node:fs/promises");
		const raw = (
			await Promise.all(
				(
					await readdir(directory)
				)
					.filter((path) => path.endsWith(".ndjson"))
					.map((path) => readFile(join(directory, path), "utf8")),
			)
		).join("\n");
		expect(raw).toContain("QUAKE.AUDIO.FILE_UNAVAILABLE");
		expect(raw).toContain("SoundboardFiles.inspect");
		expect(raw).toContain("SoundboardImporter.preview");
		expect(raw).not.toMatch(/private\/music|Bearer|secret/);
	});
});
