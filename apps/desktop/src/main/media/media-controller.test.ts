import { it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, TestClock } from "effect";
import { expect } from "vitest";
import {
	defaultClockTile,
	defaultWallpaper,
	MediaUnreadable,
	type SavedWallpaper,
} from "../../shared/display";
import { makeMediaController } from "./media-controller";
import { MediaRepository } from "./media-repository";

it.scoped(
	"SCREEN-105 preloads at duration minus 1000ms and starts the fade 200ms later without second-clock drift",
	() =>
		Effect.gen(function* () {
			const saved = {
				version: 1 as const,
				serial: "A",
				revision: 0,
				clock: defaultClockTile,
				settings: {
					...defaultWallpaper,
					displayMediaList: ["a", "b"].map((id) => ({
						name: id,
						type: "video" as const,
						format: "video/webm" as const,
						filePath: `media:${id.repeat(64)}`,
						duration: 2500,
					})),
				},
			};
			const shown: {
				index: number;
				at: number;
				preload: number | undefined;
			}[] = [];
			const controller = yield* makeMediaController({
				chooseImage: Effect.succeed(Option.none()),
				publishClock: () => Effect.void,
				publish: (snapshot) =>
					Effect.gen(function* () {
						shown.push({
							index: snapshot.activeIndex ?? 0,
							at: yield* Effect.clockWith((c) => c.currentTimeMillis),
							preload: snapshot.preload?.index,
						});
					}),
			}).pipe(
				Effect.provide(
					Layer.succeed(
						MediaRepository,
						MediaRepository.make({
							load: () => Effect.succeed({ saved, recovered: false }),
							resolve: () => Effect.succeed(Option.none()),
							save: () => Effect.die("unused"),
							restore: () => Effect.die("unused"),
							importLocal: () => Effect.die("unused"),
							discard: () => Effect.void,
						}),
					),
				),
			);
			yield* controller.request({ _tag: "select", serial: "A" });
			const fiber = yield* Effect.forkScoped(controller.ticks);
			yield* TestClock.adjust(1499);
			expect(shown).toEqual([{ index: 0, at: 0, preload: undefined }]);
			yield* TestClock.adjust(1);
			expect(shown.at(-1)).toEqual({ index: 0, at: 1500, preload: 1 });
			yield* TestClock.adjust(199);
			expect(shown).toHaveLength(2);
			yield* TestClock.adjust(1);
			expect(shown.at(-1)).toEqual({ index: 1, at: 1700, preload: undefined });
			yield* TestClock.adjust(1700);
			expect(shown.at(-1)).toEqual({ index: 0, at: 3400, preload: undefined });
			yield* Fiber.interrupt(fiber);
			const length = shown.length;
			yield* TestClock.adjust(10000);
			expect(shown).toHaveLength(length);
		}),
);

it.scoped(
	"changes playback identity on singleton append and advances from the reset deadline",
	() =>
		Effect.gen(function* () {
			const video = {
				name: "a.webm",
				type: "video" as const,
				format: "video/webm" as const,
				filePath: `media:${"a".repeat(64)}`,
				duration: 60000,
			};
			let saved = {
				version: 1 as const,
				serial: "A",
				revision: 0,
				clock: defaultClockTile,
				settings: { ...defaultWallpaper, displayMediaList: [video] },
			};
			const controller = yield* makeMediaController({
				chooseImage: Effect.succeed(Option.none()),
				publish: () => Effect.void,
				publishClock: () => Effect.void,
			}).pipe(
				Effect.provide(
					Layer.succeed(
						MediaRepository,
						MediaRepository.make({
							load: () => Effect.sync(() => ({ saved, recovered: false })),
							resolve: () => Effect.succeed(Option.none()),
							save: () => Effect.die("unused"),
							restore: () => Effect.die("unused"),
							importLocal: () => Effect.die("unused"),
							discard: () => Effect.void,
						}),
					),
				),
			);
			const before = yield* controller.request({ _tag: "select", serial: "A" });
			const ticks = yield* Effect.forkScoped(controller.ticks);
			yield* TestClock.adjust(50000);
			saved = {
				...saved,
				revision: 1,
				settings: {
					...saved.settings,
					displayMediaList: [
						video,
						{ ...video, name: "b.webm", filePath: `media:${"b".repeat(64)}` },
					],
				},
			};
			const after = yield* controller.request({ _tag: "read" });
			expect(after.playbackId).not.toBe(before.playbackId);
			expect((yield* controller.request({ _tag: "read" })).playbackId).toBe(
				after.playbackId,
			);
			yield* TestClock.adjust(59199);
			expect((yield* controller.request({ _tag: "read" })).activeIndex).toBe(0);
			yield* TestClock.adjust(1);
			const next = yield* controller.request({ _tag: "read" });
			expect(next.activeIndex).toBe(1);
			expect(next.playbackId).not.toBe(after.playbackId);
			yield* Fiber.interrupt(ticks);
		}),
);

function playlistFixture(unreadable: readonly number[] = []) {
	let saved: SavedWallpaper = {
		version: 1,
		serial: "A",
		revision: 0,
		clock: defaultClockTile,
		settings: {
			...defaultWallpaper,
			displayMediaList: ["a", "b", "c"].map((id) => ({
				name: id,
				type: "video" as const,
				format: "video/webm" as const,
				filePath: `media:${id.repeat(64)}`,
				duration: 5000,
			})),
		},
	};
	const resolved: number[] = [];
	const shown: { index: number; asset: string }[] = [];
	return {
		set: (transparent: boolean) => {
			saved = {
				...saved,
				revision: saved.revision + 1,
				settings: { ...saved.settings, isTransparent: transparent },
			};
		},
		resolved,
		shown,
		make: makeMediaController({
			chooseImage: Effect.succeed(Option.none()),
			publishClock: () => Effect.void,
			publish: (snapshot) =>
				Effect.sync(() => {
					shown.push({
						index: snapshot.activeIndex ?? 0,
						asset: snapshot.asset._tag,
					});
				}),
		}).pipe(
			Effect.provide(
				Layer.succeed(
					MediaRepository,
					MediaRepository.make({
						load: () => Effect.sync(() => ({ saved, recovered: false })),
						resolve: (_, index = 0) =>
							Effect.gen(function* () {
								resolved.push(index);
								if (unreadable.includes(index))
									return yield* new MediaUnreadable(undefined);
								return Option.some({
									format: "video/webm" as const,
									width: 320,
									height: 80,
									durationMs: 5000,
									dataUrl: "data:video/webm;base64,AAAA",
								});
							}),
						save: () => Effect.die("unused"),
						restore: () => Effect.die("unused"),
						importLocal: () => Effect.die("unused"),
						discard: () => Effect.void,
					}),
				),
			),
		),
	};
}
it.scoped(
	"WIDGETS-131 stops media work while transparent and wakes the same playlist when opaque",
	() =>
		Effect.gen(function* () {
			const f = playlistFixture();
			f.set(true);
			const controller = yield* f.make;
			yield* controller.request({ _tag: "select", serial: "A" });
			const fiber = yield* Effect.forkScoped(controller.ticks);
			yield* TestClock.adjust(20000);
			expect(f.resolved).toEqual([]);
			expect(f.shown).toEqual([{ index: 0, asset: "empty" }]);
			f.set(false);
			yield* controller.request({ _tag: "read" });
			yield* TestClock.adjust(4200);
			expect(f.shown.at(-1)).toEqual({ index: 1, asset: "ready" });
			yield* Fiber.interrupt(fiber);
		}),
);
it.scoped(
	"SCREEN-105 skips unreadable managed bytes and excludes failed items from subsequent transitions",
	() =>
		Effect.gen(function* () {
			const f = playlistFixture([0]);
			const controller = yield* f.make;
			const selected = yield* controller.request({
				_tag: "select",
				serial: "A",
			});
			expect(selected.activeIndex).toBe(1);
			const fiber = yield* Effect.forkScoped(controller.ticks);
			yield* TestClock.adjust(12600);
			expect(f.shown.every((snapshot) => snapshot.index !== 0)).toBe(true);
			expect(f.shown.some((snapshot) => snapshot.index === 2)).toBe(true);
			expect(f.resolved.filter((index) => index === 0)).toHaveLength(1);
			yield* Fiber.interrupt(fiber);
		}),
);
it.scoped(
	"SCREEN-105 exhausts a broken playlist once and leaves a stable fallback without timer retries",
	() =>
		Effect.gen(function* () {
			const f = playlistFixture([0, 1, 2]);
			const controller = yield* f.make;
			expect(
				(yield* controller.request({ _tag: "select", serial: "A" })).asset._tag,
			).toBe("unreadable");
			const fiber = yield* Effect.forkScoped(controller.ticks);
			yield* TestClock.adjust(60000);
			expect(f.resolved).toEqual([0, 1, 2]);
			expect(f.shown).toEqual([{ index: 2, asset: "unreadable" }]);
			yield* Fiber.interrupt(fiber);
		}),
);

it.scoped(
	"SCREEN-105 loops the sole surviving video and stops transition work",
	() =>
		Effect.gen(function* () {
			const f = playlistFixture([0, 1]);
			const controller = yield* f.make;
			const selected = yield* controller.request({
				_tag: "select",
				serial: "A",
			});
			expect(selected).toMatchObject({ activeIndex: 2, loop: true });
			const fiber = yield* Effect.forkScoped(controller.ticks);
			const reads = f.resolved.length;
			const publications = f.shown.length;
			yield* TestClock.adjust(60000);
			expect(f.resolved).toHaveLength(reads);
			expect(f.shown).toHaveLength(publications);
			yield* Fiber.interrupt(fiber);
		}),
);

it.scoped(
	"SCREEN-105 sends each preload asset only once across transition and hydrates late subscribers",
	() =>
		Effect.gen(function* () {
			const f = playlistFixture();
			const controller = yield* f.make;
			const first = yield* controller.request({ _tag: "select", serial: "A" });
			const frames: unknown[] = [];
			// Exercise the production wire owner with controller snapshots, including preload promotion.
			const { WallpaperSender, WallpaperReceiver } = yield* Effect.promise(
				() => import("../../shared/wallpaper-transfer"),
			);
			const sender = new WallpaperSender();
			const receiver = new WallpaperReceiver();
			frames.push(sender.encode(first));
			expect(receiver.decode(frames[0])).toEqual(first);
			const ticks = yield* Effect.forkScoped(controller.ticks);
			yield* TestClock.adjust(4000);
			const preload = yield* controller.request({ _tag: "read" });
			frames.push(sender.encode(preload));
			expect(receiver.decode(frames[1])).toEqual(preload);
			yield* TestClock.adjust(200);
			const active = yield* controller.request({ _tag: "read" });
			frames.push(sender.encode(active));
			expect(receiver.decode(frames[2])).toEqual(active);
			expect(JSON.stringify(frames).match(/dataUrl/g)).toHaveLength(2);
			const late = new WallpaperSender();
			expect(new WallpaperReceiver().decode(late.encode(active))).toEqual(
				active,
			);
			// Navigation clears sender state, so the reloaded renderer gets full bytes again.
			sender.clear();
			expect(new WallpaperReceiver().decode(sender.encode(active))).toEqual(
				active,
			);
			yield* Fiber.interrupt(ticks);
		}),
);
