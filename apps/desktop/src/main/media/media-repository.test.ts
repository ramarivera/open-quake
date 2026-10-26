import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { it as effectIt } from "@effect/vitest";
import { Effect, Either, Fiber, Layer, Option, TestClock } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultClockTile, defaultWallpaper } from "../../shared/display";
import { ImageDecoder, normalizeLocalSelection } from "./image-decoder";
import { makeMediaController } from "./media-controller";
import { MediaFiles, MediaRoot } from "./media-files";
import { MediaRepository } from "./media-repository";

const native = vi.hoisted(() => ({
	decode: vi.fn(),
	metadata: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("electron", () => ({
	BrowserWindow: class {
		webContents = {
			setAudioMuted: () => {},
			executeJavaScript: native.metadata,
		};
		loadURL = async () => {};
		isDestroyed = () => false;
		destroy = () => {};
	},
	nativeImage: { createFromBuffer: native.decode },
}));
vi.mock("node:fs/promises", async (load) => {
	const actual = await load<typeof import("node:fs/promises")>();
	return {
		...actual,
		rename: vi.fn(actual.rename),
		writeFile: vi.fn(actual.writeFile),
		unlink: vi.fn(actual.unlink),
	};
});
// Native decoding has its own Electron smoke gate. This fixture isolates IO and rollback.
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO/8AAAAASUVORK5CYII=",
	"base64",
);
const jpeg = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]);

describe("desktop media repository and actual disk adapter", () => {
	let directory: string;
	let root: string;
	let imagePath: string;
	let layer: Layer.Layer<MediaRepository>;
	const assetsDirectory = (serial: string): string =>
		join(root, "assets", createHash("sha256").update(serial).digest("hex"));
	const settingsFile = (serial: string): string =>
		join(
			root,
			"settings",
			`${createHash("sha256").update(serial).digest("hex")}.json`,
		);
	beforeEach(async () => {
		native.metadata.mockReset();
		native.metadata.mockResolvedValue({
			width: 320,
			height: 80,
			durationMs: 3000,
		});
		directory = await fs.mkdtemp(join(tmpdir(), "open-quake-media-"));
		root = join(directory, "managed");
		imagePath = join(directory, "corners.png");
		await fs.writeFile(imagePath, png);
		layer = MediaRepository.Default.pipe(
			Layer.provide(Layer.succeed(MediaRoot, root)),
		);
		native.decode.mockImplementation(() => ({
			isEmpty: () => false,
			getSize: () => ({ width: 480, height: 480 }),
		}));
	});
	afterEach(async () => {
		await fs.rm(directory, { recursive: true, force: true });
	});

	it("probes video once across import, duplicate import, save and snapshots while verifying managed bytes", async () => {
		const videoPath = join(directory, "silent.webm");
		await fs.writeFile(videoPath, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* MediaRepository;
				const imported = yield* repo.importLocal("A", 0, videoPath, true);
				yield* repo.importLocal("A", 1, videoPath, true);
				yield* repo.save(
					"A",
					1,
					{ ...imported.saved.settings, enableSound: true },
					imported.saved.clock,
				);
				const controller = yield* makeMediaController({
					chooseImage: Effect.succeed(Option.none()),
					publish: () => Effect.void,
					publishClock: () => Effect.void,
				});
				yield* controller.request({ _tag: "select", serial: "A" });
				for (let i = 0; i < 4; i++)
					expect((yield* controller.request({ _tag: "read" })).asset._tag).toBe(
						"ready",
					);
				expect(native.metadata).toHaveBeenCalledTimes(1);
				const media = imported.saved.settings.displayMediaList[0];
				if (!media) throw new Error("Missing video");
				expect(
					(yield* repo
						.resolve({
							...imported.saved,
							settings: {
								...imported.saved.settings,
								displayMediaList: [
									{ ...media, type: "video", format: "video/mp4" },
								],
							},
						})
						.pipe(Effect.either))._tag,
				).toBe("Left");
				yield* Effect.promise(() =>
					fs.writeFile(
						join(assetsDirectory("A"), media.filePath.slice(6)),
						"tampered",
					),
				);
				expect((yield* controller.request({ _tag: "read" })).asset._tag).toBe(
					"unreadable",
				);
				expect(native.metadata).toHaveBeenCalledTimes(1);
			}).pipe(Effect.provide(layer)),
		);
	});

	it("keeps controller reads and selection responsive during a video import probe", async () => {
		const videoPath = join(directory, "slow.webm");
		await fs.writeFile(videoPath, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
		let entered: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let resume: (value: unknown) => void = () => {};
		native.metadata.mockImplementationOnce(() => {
			entered();
			return new Promise((resolve) => {
				resume = resolve;
			});
		});
		await Effect.runPromise(
			Effect.gen(function* () {
				const controller = yield* makeMediaController({
					chooseImage: Effect.succeed(Option.some(videoPath)),
					publish: () => Effect.void,
					publishClock: () => Effect.void,
				});
				const pending = yield* Effect.fork(
					controller.request({
						_tag: "import",
						serial: "desktop-preview",
						revision: 0,
						append: true,
					}),
				);
				yield* Effect.promise(() => ready);
				const read = yield* controller
					.request({ _tag: "read" })
					.pipe(Effect.timeoutOption(100));
				const selection = yield* controller
					.request({ _tag: "select", serial: "B" })
					.pipe(Effect.timeoutOption(100));
				resume({ width: 320, height: 80, durationMs: 3000 });
				yield* Fiber.join(pending);
				expect(Option.isSome(read)).toBe(true);
				expect(Option.isSome(selection)).toBe(true);
				expect((yield* controller.request({ _tag: "read" })).saved.serial).toBe(
					"B",
				);
				expect(native.metadata).toHaveBeenCalledTimes(1);
			}).pipe(Effect.provide(layer)),
		);
	});

	it("discards a cold video snapshot after selection changes without blocking the new selection", async () => {
		const videoPath = join(directory, "cold.webm");
		await fs.writeFile(videoPath, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
		await Effect.runPromise(
			MediaRepository.importLocal("A", 0, videoPath).pipe(
				Effect.provide(layer),
			),
		);
		let entered: () => void = () => {};
		const ready = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let resume: (value: unknown) => void = () => {};
		native.metadata.mockImplementationOnce(() => {
			entered();
			return new Promise((resolve) => {
				resume = resolve;
			});
		});
		const shown: string[] = [];
		await Effect.runPromise(
			Effect.gen(function* () {
				const controller = yield* makeMediaController({
					chooseImage: Effect.succeed(Option.none()),
					publish: (snapshot) =>
						Effect.sync(() => {
							shown.push(snapshot.saved.serial);
						}),
					publishClock: () => Effect.void,
				});
				const pending = yield* Effect.fork(
					controller.request({ _tag: "select", serial: "A" }),
				);
				yield* Effect.promise(() => ready);
				const selection = yield* controller
					.request({ _tag: "select", serial: "B" })
					.pipe(Effect.timeoutOption(100));
				resume({ width: 320, height: 80, durationMs: 3000 });
				const result = yield* Fiber.join(pending);
				expect(Option.isSome(selection)).toBe(true);
				expect(result.saved.serial).toBe("B");
				expect(shown).toEqual(["B", "B"]);
			}).pipe(Effect.provide(layer)),
		);
	});

	it("accepts decoded PNG/JPEG and normalizes selected legacy file URLs", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* MediaRepository;
				const imported = yield* repo.importLocal(
					"serial-A",
					0,
					pathToFileURL(imagePath).href,
				);
				expect(imported.normalizedFileUrl).toBe(true);
				expect(imported.saved.settings.displayMediaList[0]?.format).toBe(
					"image/png",
				);
				expect(imported.saved.settings.displayMediaList[0]?.filePath).toMatch(
					/^media:[a-f0-9]{64}$/,
				);
				expect(
					Option.getOrNull(yield* repo.resolve(imported.saved))?.width,
				).toBe(480);
				yield* Effect.promise(() => fs.writeFile(imagePath, jpeg));
				const second = yield* repo.importLocal("serial-A", 1, imagePath);
				expect(second.saved.settings.displayMediaList[0]?.format).toBe(
					"image/jpeg",
				);
				expect(native.decode).toHaveBeenCalledWith(jpeg);
			}).pipe(Effect.provide(layer)),
		);
	});
	it("persists ordered playlists and sound, deduplicates imports, rejects stale moves and removes one item", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* MediaRepository;
				yield* repo.importLocal("A", 0, imagePath, true);
				yield* repo.importLocal("A", 1, imagePath, true);
				expect((yield* repo.load("A")).saved.revision).toBe(1);
				const secondPath = join(directory, "second.jpg");
				yield* Effect.promise(() => fs.writeFile(secondPath, jpeg));
				yield* repo.importLocal("A", 1, secondPath, true);
				const controller = yield* makeMediaController({
					chooseImage: Effect.succeed(Option.none()),
					publish: () => Effect.void,
					publishClock: () => Effect.void,
				});
				yield* controller.request({ _tag: "select", serial: "A" });
				const original = (yield* repo.load("A")).saved.settings
					.displayMediaList;
				const moved = yield* controller.request({
					_tag: "reorder",
					serial: "A",
					revision: 2,
					from: 1,
					to: 0,
				});
				expect(moved.saved.settings.displayMediaList).toEqual([
					original[1],
					original[0],
				]);
				const sound = yield* controller.request({
					_tag: "sound",
					serial: "A",
					revision: 3,
					enableSound: true,
				});
				expect(sound.saved.settings.enableSound).toBe(true);
				for (const command of [
					{ _tag: "reorder", from: 0, to: 9, revision: 4 },
					{ _tag: "reorder", from: 0, to: 1, revision: 2 },
				])
					expect(
						(yield* controller
							.request({ serial: "A", ...command })
							.pipe(Effect.either))._tag,
					).toBe("Left");
				expect((yield* repo.load("A")).saved).toEqual(sound.saved);
				expect((yield* repo.load("B")).saved.settings.enableSound).toBe(false);
				const removed = yield* controller.request({
					_tag: "remove",
					serial: "A",
					revision: 4,
					index: 0,
				});
				expect(removed.saved.settings.displayMediaList).toEqual([original[0]]);
			}).pipe(Effect.provide(layer)),
		);
	});

	effectIt.scoped(
		"advances the persisted playlist on its clock and wraps repeatedly",
		() =>
			Effect.gen(function* () {
				const repo = yield* MediaRepository;
				yield* repo.importLocal("loop", 0, imagePath, true);
				const secondPath = join(directory, "second.jpg");
				yield* Effect.promise(() => fs.writeFile(secondPath, jpeg));
				yield* repo.importLocal("loop", 1, secondPath, true);
				const { saved: loopSaved } = yield* repo.load("loop");
				const shown: number[] = [];
				const controller = yield* makeMediaController({
					chooseImage: Effect.succeed(Option.none()),
					publish: (snapshot) =>
						Effect.sync(() => {
							shown.push(snapshot.activeIndex ?? 0);
						}),
					publishClock: () => Effect.void,
				}).pipe(
					Effect.provideService(
						MediaRepository,
						MediaRepository.make({
							...repo,
							load: () =>
								Effect.succeed({ saved: loopSaved, recovered: false }),
							resolve: () => Effect.succeed(Option.none()),
						}),
					),
				);
				yield* controller.request({ _tag: "select", serial: "loop" });
				const fiber = yield* Effect.forkScoped(controller.ticks);
				yield* TestClock.adjust(4999);
				expect(shown).toEqual([0]);
				yield* TestClock.adjust(1);
				expect(shown).toEqual([0, 1]);
				yield* TestClock.adjust(15000);
				expect(shown).toEqual([0, 1, 0, 1, 0]);
				yield* Fiber.interrupt(fiber);
				yield* TestClock.adjust(5000);
				expect(shown).toEqual([0, 1, 0, 1, 0]);
			}).pipe(Effect.provide(layer)),
	);

	it("keeps two serials independent across restart and source deletion", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* MediaRepository;
				const a = yield* repo.importLocal("A", 0, imagePath);
				yield* repo.save(
					"B",
					0,
					{ ...defaultWallpaper, bgFillMode: "center" },
					{
						...defaultClockTile,
						actions: [{ type: "hourFormat", value: "12h" }],
					},
				);
				expect((yield* repo.load("A")).saved).toEqual(a.saved);
			}).pipe(Effect.provide(layer)),
		);
		await fs.unlink(imagePath);
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* MediaRepository;
				expect((yield* repo.load("A")).saved.settings.bgFillMode).toBe("cover");
				expect(
					Option.isSome(yield* repo.resolve((yield* repo.load("A")).saved)),
				).toBe(true);
				expect((yield* repo.load("B")).saved.settings.bgFillMode).toBe(
					"center",
				);
				expect((yield* repo.load("B")).saved.clock.actions[0].value).toBe(
					"12h",
				);
			}).pipe(Effect.provide(layer)),
		);
	});
	it("preserves the last revision on missing, unsupported, decode-failed, or invalid imports", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* MediaRepository;
				const good = (yield* repo.importLocal("A", 0, imagePath)).saved;
				const missing = yield* repo
					.importLocal("A", 1, join(directory, "missing.png"))
					.pipe(Effect.either);
				expect(missing._tag).toBe("Left");
				if (Either.isLeft(missing)) {
					expect(missing.left._tag).toBe("MediaUnreadable");
					expect(missing.left.originalCause).toBeInstanceOf(Error);
					expect(JSON.stringify(missing.left)).not.toContain(directory);
				}
				yield* Effect.promise(() => fs.writeFile(imagePath, "GIF89a"));
				expect(
					Either.isLeft(
						yield* repo.importLocal("A", 1, imagePath).pipe(Effect.either),
					),
				).toBe(true);
				yield* Effect.promise(() => fs.writeFile(imagePath, png));
				const cause = new Error("secret-path/token=private");
				native.decode.mockImplementationOnce(() => {
					throw cause;
				});
				const failed = yield* repo
					.importLocal("A", 1, imagePath)
					.pipe(Effect.either);
				if (Either.isLeft(failed)) {
					expect(failed.left.code).toBe("QUAKE.DISPLAY.MEDIA_UNREADABLE");
					expect(failed.left.originalCause).toBe(cause);
					expect(JSON.stringify(failed.left)).not.toContain("private");
				} else throw new Error("Decode failure was not preserved");
				expect(
					Either.isLeft(
						yield* repo
							.save("A", 1, { ...good.settings, gapInterval: -1 }, good.clock)
							.pipe(Effect.either),
					),
				).toBe(true);
				expect((yield* repo.load("A")).saved).toEqual(good);
			}).pipe(Effect.provide(layer)),
		);
	});
	it("backs up, restores, and recovers corrupt settings without copying corrupt primary data", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* MediaRepository;
				const first = (yield* repo.importLocal("A", 0, imagePath)).saved;
				yield* repo.save(
					"A",
					1,
					{ ...first.settings, bgFillMode: "contain" },
					first.clock,
				);
				const restored = yield* repo.restore("A", 2);
				expect(restored.settings.bgFillMode).toBe("cover");
				expect(restored.revision).toBe(3);
				yield* Effect.promise(() => fs.writeFile(settingsFile("A"), "{"));
				const recovered = yield* repo.load("A");
				expect(recovered.recovered).toBe(true);
				expect(recovered.saved.settings.bgFillMode).toBe("contain");
				const newSaved = yield* repo.save(
					"A",
					recovered.saved.revision,
					recovered.saved.settings,
					recovered.saved.clock,
				);
				expect((yield* repo.load("A")).saved).toEqual(newSaved);
			}).pipe(Effect.provide(layer)),
		);
	});
	it.each([
		"primary write",
		"backup write",
		"primary rename",
		"backup rename",
	] as const)(
		"retains both revisions and restores the prior settings after failed %s",
		async (failure) => {
			const actual =
				await vi.importActual<typeof import("node:fs/promises")>(
					"node:fs/promises",
				);
			await Effect.runPromise(
				Effect.gen(function* () {
					const repo = yield* MediaRepository;
					const first = (yield* repo.importLocal("A", 0, imagePath)).saved;
					const second = yield* repo.save(
						"A",
						1,
						{ ...first.settings, bgFillMode: "contain" },
						first.clock,
					);
					const backupFile = settingsFile("A").replace(".json", ".backup.json");
					const primaryBefore = yield* Effect.promise(() =>
						fs.readFile(settingsFile("A"), "utf8"),
					);
					const backupBefore = yield* Effect.promise(() =>
						fs.readFile(backupFile, "utf8"),
					);
					const assetsBefore = yield* Effect.promise(() =>
						fs.readdir(assetsDirectory("A")),
					);
					const cause = Object.assign(new Error("/private/secret-token"), {
						code: "EACCES",
					});
					if (failure.endsWith("write")) {
						if (failure === "backup write")
							vi.mocked(fs.writeFile).mockImplementationOnce(actual.writeFile);
						vi.mocked(fs.writeFile).mockRejectedValueOnce(cause);
					} else {
						if (failure === "backup rename")
							vi.mocked(fs.rename).mockImplementationOnce(actual.rename);
						vi.mocked(fs.rename).mockRejectedValueOnce(cause);
					}
					const result = yield* repo
						.save(
							"A",
							2,
							{ ...second.settings, bgFillMode: "center" },
							second.clock,
						)
						.pipe(Effect.either);
					if (Either.isLeft(result)) {
						expect(result.left._tag).toBe("MediaPersistenceFailed");
						expect(result.left.originalCause).toBe(cause);
						expect(JSON.stringify(result.left)).not.toContain("secret-token");
					} else throw new Error("Write unexpectedly succeeded");
					expect((yield* repo.load("A")).saved).toEqual(second);
					expect(
						yield* Effect.promise(() => fs.readFile(settingsFile("A"), "utf8")),
					).toBe(primaryBefore);
					expect(
						yield* Effect.promise(() => fs.readFile(backupFile, "utf8")),
					).toBe(backupBefore);
					expect(
						yield* Effect.promise(() => fs.readdir(assetsDirectory("A"))),
					).toEqual(assetsBefore);
					const restored = yield* repo.restore("A", 2);
					expect(restored.settings).toEqual(first.settings);
					expect(restored.revision).toBe(3);
				}).pipe(Effect.provide(layer)),
			);
			expect(
				(await fs.readdir(join(root, "settings"))).some((name) =>
					name.endsWith(".tmp"),
				),
			).toBe(false);
		},
	);
	it("collects only unreferenced assets for the committed serial and preserves its restore point", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* MediaRepository;
				const a = (yield* repo.importLocal("A", 0, imagePath)).saved;
				const b = (yield* repo.importLocal("B", 0, imagePath)).saved;
				const firstHash = a.settings.displayMediaList[0]?.filePath.slice(6);
				yield* Effect.promise(() => fs.writeFile(imagePath, jpeg));
				const second = (yield* repo.importLocal("A", 1, imagePath)).saved;
				const secondHash =
					second.settings.displayMediaList[0]?.filePath.slice(6);
				expect(
					(yield* Effect.promise(() =>
						fs.readdir(assetsDirectory("A")),
					)).sort(),
				).toEqual([firstHash, secondHash].sort());
				const cause = new Error("failed settings commit");
				vi.mocked(fs.rename).mockRejectedValueOnce(cause);
				expect(
					Either.isLeft(
						yield* repo
							.save("A", 2, defaultWallpaper, second.clock)
							.pipe(Effect.either),
					),
				).toBe(true);
				expect(
					yield* Effect.promise(() => fs.readdir(assetsDirectory("A"))),
				).toHaveLength(2);
				const cleared = yield* repo.save(
					"A",
					2,
					defaultWallpaper,
					second.clock,
				);
				expect(
					yield* Effect.promise(() => fs.readdir(assetsDirectory("A"))),
				).toEqual([secondHash]);
				expect(
					yield* Effect.promise(() => fs.readdir(assetsDirectory("B"))),
				).toEqual([firstHash]);
				expect(Option.isSome(yield* repo.resolve(b))).toBe(true);
				const restored = yield* repo.restore("A", cleared.revision);
				expect(restored.settings).toEqual(second.settings);
				expect(Option.isSome(yield* repo.resolve(restored))).toBe(true);
				const clearedAgain = yield* repo.save(
					"A",
					restored.revision,
					defaultWallpaper,
					restored.clock,
				);
				yield* repo.save(
					"A",
					clearedAgain.revision,
					defaultWallpaper,
					clearedAgain.clock,
				);
				expect(
					yield* Effect.promise(() => fs.readdir(assetsDirectory("A"))),
				).toEqual([]);
				expect(Option.isSome(yield* repo.resolve(b))).toBe(true);
			}).pipe(Effect.provide(layer)),
		);
	});
	it("reads legacy flat assets and retains every serial's current and backup references", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* MediaRepository;
				const a = (yield* repo.importLocal("A", 0, imagePath)).saved;
				const b = (yield* repo.importLocal("B", 0, imagePath)).saved;
				const reference = a.settings.displayMediaList[0]?.filePath;
				if (!reference) throw new Error("Missing imported asset");
				const globalAsset = join(root, "assets", reference.slice(6));
				yield* Effect.promise(async () => {
					await fs.rename(
						join(assetsDirectory("A"), reference.slice(6)),
						globalAsset,
					);
					await fs.unlink(join(assetsDirectory("B"), reference.slice(6)));
				});
				expect(Option.isSome(yield* repo.resolve(b))).toBe(true);
				const aCleared = yield* repo.save("A", 1, defaultWallpaper, a.clock);
				yield* repo.save(
					"A",
					aCleared.revision,
					defaultWallpaper,
					aCleared.clock,
				);
				expect(Option.isSome(yield* repo.resolve(b))).toBe(true);
				const bCleared = yield* repo.save("B", 1, defaultWallpaper, b.clock);
				expect(Option.isSome(yield* repo.resolve(b))).toBe(true);
				yield* repo.save(
					"B",
					bCleared.revision,
					defaultWallpaper,
					bCleared.clock,
				);
				expect(
					yield* Effect.promise(() => fs.readdir(join(root, "assets"))),
				).not.toContain(reference.slice(6));
			}).pipe(Effect.provide(layer)),
		);
	});
	it("skips collection when a committed revision cannot be validated", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* MediaRepository;
				const first = (yield* repo.importLocal("A", 0, imagePath)).saved;
				yield* Effect.promise(() => fs.writeFile(imagePath, jpeg));
				yield* repo.importLocal("A", 1, imagePath);
				yield* Effect.promise(() =>
					fs.writeFile(settingsFile("A").replace(".json", ".backup.json"), "{"),
				);
				const collection = yield* MediaFiles.collectAssets("A").pipe(
					Effect.provide(
						MediaFiles.Default.pipe(
							Layer.provide(Layer.succeed(MediaRoot, root)),
						),
					),
					Effect.either,
				);
				expect(Either.isLeft(collection)).toBe(true);
				expect(
					yield* Effect.promise(() => fs.readdir(assetsDirectory("A"))),
				).toHaveLength(2);
				expect(Option.isSome(yield* repo.resolve(first))).toBe(true);
			}).pipe(Effect.provide(layer)),
		);
	});
	it("keeps a committed save successful when asset cleanup fails and retries later", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* MediaRepository;
				const first = (yield* repo.importLocal("A", 0, imagePath)).saved;
				yield* Effect.promise(() => fs.writeFile(imagePath, jpeg));
				const second = (yield* repo.importLocal("A", 1, imagePath)).saved;
				const actual = yield* Effect.promise(() =>
					vi.importActual<typeof import("node:fs/promises")>(
						"node:fs/promises",
					),
				);
				// Two temporary-file cleanups precede collection of the retired image.
				vi.mocked(fs.unlink)
					.mockImplementationOnce(actual.unlink)
					.mockImplementationOnce(actual.unlink)
					.mockRejectedValueOnce(new Error("cleanup unavailable"));
				const cleared = yield* repo.save(
					"A",
					2,
					defaultWallpaper,
					second.clock,
				);
				expect(cleared.revision).toBe(3);
				expect((yield* repo.load("A")).saved).toEqual(cleared);
				expect(
					yield* Effect.promise(() => fs.readdir(assetsDirectory("A"))),
				).toHaveLength(2);
				yield* repo.save("A", cleared.revision, defaultWallpaper, first.clock);
				expect(
					yield* Effect.promise(() => fs.readdir(assetsDirectory("A"))),
				).toEqual([]);
			}).pipe(Effect.provide(layer)),
		);
	});
	it("rejects stale revisions instead of losing a concurrent save", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* MediaRepository;
				const results = yield* Effect.all(
					[
						repo
							.save("A", 0, defaultWallpaper, defaultClockTile)
							.pipe(Effect.either),
						repo
							.save("A", 0, defaultWallpaper, defaultClockTile)
							.pipe(Effect.either),
					],
					{ concurrency: "unbounded" },
				);
				expect(results.filter(Either.isRight)).toHaveLength(1);
				expect(results.filter(Either.isLeft)).toHaveLength(1);
			}).pipe(Effect.provide(layer)),
		);
	});
	it("publishes neutral fallback for deleted assets without changing selection or device delivery", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* MediaRepository;
				const imported = (yield* repo.importLocal("A", 0, imagePath)).saved;
				const reference = imported.settings.displayMediaList[0]?.filePath;
				yield* Effect.promise(() =>
					fs.unlink(
						join(assetsDirectory("A"), reference?.slice(6) ?? "missing"),
					),
				);
				const published: unknown[] = [];
				const controller = yield* makeMediaController({
					chooseImage: Effect.succeed(Option.none()),
					publish: (snapshot) =>
						Effect.sync(() => {
							published.push(snapshot);
						}),
					publishClock: () => Effect.void,
				});
				const snapshot = yield* controller.request({
					_tag: "select",
					serial: "A",
				});
				expect(snapshot.asset._tag).toBe("unreadable");
				expect(snapshot.saved).toEqual(imported);
				expect(snapshot.deviceDelivery).toBe("unverified");
				expect(published).toEqual([snapshot]);
				expect(
					Either.isLeft(
						yield* controller
							.request({
								_tag: "configure",
								serial: "B",
								revision: 0,
								fillMode: "cover",
								hourFormat: "24h",
							})
							.pipe(Effect.either),
					),
				).toBe(true);
			}).pipe(Effect.provide(layer)),
		);
	});
	it("rejects unsafe file URLs and invalid image bodies before native decoding", async () => {
		const result = await Effect.runPromise(
			normalizeLocalSelection("file://remote-host/private/image.png").pipe(
				Effect.either,
			),
		);
		expect(Either.isLeft(result)).toBe(true);
		await Effect.runPromise(
			Effect.gen(function* () {
				const decoder = yield* ImageDecoder;
				for (const bytes of [
					Buffer.alloc(0),
					Buffer.alloc(8 * 1024 * 1024 + 1),
					Buffer.from("GIF89a"),
				])
					expect(
						Either.isLeft(yield* decoder.decode(bytes).pipe(Effect.either)),
					).toBe(true);
				expect(native.decode).not.toHaveBeenCalled();
			}).pipe(Effect.provide(ImageDecoder.Default)),
		);
	});
});
