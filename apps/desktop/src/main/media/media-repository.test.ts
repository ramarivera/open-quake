import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Either, Layer, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	defaultClockTile,
	defaultWallpaper,
} from "../../renderer/src/wallpaper/display";
import { ImageDecoder, normalizeLocalSelection } from "./image-decoder";
import { makeMediaController } from "./media-controller";
import { MediaRoot } from "./media-files";
import { MediaRepository } from "./media-repository";

const native = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock("electron", () => ({
	nativeImage: { createFromBuffer: native.decode },
}));
vi.mock("node:fs/promises", async (load) => {
	const actual = await load<typeof import("node:fs/promises")>();
	return { ...actual, rename: vi.fn(actual.rename) };
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
	const settingsFile = (serial: string): string =>
		join(
			root,
			"settings",
			`${createHash("sha256").update(serial).digest("hex")}.json`,
		);
	beforeEach(async () => {
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
	it.each(["backup", "primary"])(
		"retains settings and scrubs the real cause when %s rename fails",
		async (failure) => {
			const actual =
				await vi.importActual<typeof import("node:fs/promises")>(
					"node:fs/promises",
				);
			await Effect.runPromise(
				Effect.gen(function* () {
					const repo = yield* MediaRepository;
					const first = (yield* repo.importLocal("A", 0, imagePath)).saved;
					const cause = Object.assign(new Error("/private/secret-token"), {
						code: "EACCES",
					});
					if (failure === "primary")
						vi.mocked(fs.rename).mockImplementationOnce(actual.rename);
					vi.mocked(fs.rename).mockRejectedValueOnce(cause);
					const result = yield* repo
						.save(
							"A",
							1,
							{ ...first.settings, bgFillMode: "center" },
							first.clock,
						)
						.pipe(Effect.either);
					if (Either.isLeft(result)) {
						expect(result.left._tag).toBe("MediaPersistenceFailed");
						expect(result.left.originalCause).toBe(cause);
						expect(JSON.stringify(result.left)).not.toContain("secret-token");
					} else throw new Error("Write unexpectedly succeeded");
					expect((yield* repo.load("A")).saved).toEqual(first);
				}).pipe(Effect.provide(layer)),
			);
			expect(
				(await fs.readdir(join(root, "settings"))).some((name) =>
					name.endsWith(".tmp"),
				),
			).toBe(false);
		},
	);
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
					fs.unlink(join(root, "assets", reference?.slice(6) ?? "missing")),
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
