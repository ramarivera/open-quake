import { it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, TestClock } from "effect";
import { expect } from "vitest";
import { defaultClockTile, defaultWallpaper } from "../../shared/display";
import { makeMediaController } from "./media-controller";
import { MediaRepository } from "./media-repository";

it.scoped(
	"switches two 2500ms videos at 2.5s and 5s without display-clock drift",
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
						name: `${id}.webm`,
						type: "video" as const,
						format: "video/webm" as const,
						filePath: `media:${id.repeat(64)}`,
						duration: 2500,
					})),
				},
			};
			const shown: { index: number; at: number }[] = [];
			const controller = yield* makeMediaController({
				chooseImage: Effect.succeed(Option.none()),
				publishClock: () => Effect.void,
				publish: (snapshot) =>
					Effect.gen(function* () {
						shown.push({
							index: snapshot.activeIndex ?? 0,
							at: yield* Effect.clockWith((clock) => clock.currentTimeMillis),
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
						}),
					),
				),
			);
			yield* controller.request({ _tag: "select", serial: "A" });
			const ticks = yield* Effect.forkScoped(controller.ticks);
			yield* TestClock.adjust(2499);
			expect(shown).toEqual([{ index: 0, at: 0 }]);
			yield* TestClock.adjust(1);
			expect(shown).toEqual([
				{ index: 0, at: 0 },
				{ index: 1, at: 2500 },
			]);
			yield* TestClock.adjust(2499);
			expect(shown).toHaveLength(2);
			yield* TestClock.adjust(1);
			expect(shown).toEqual([
				{ index: 0, at: 0 },
				{ index: 1, at: 2500 },
				{ index: 0, at: 5000 },
			]);
			yield* TestClock.adjust(10000);
			expect(shown.map((item) => item.at)).toEqual([
				0, 2500, 5000, 7500, 10000, 12500, 15000,
			]);
			yield* Fiber.interrupt(ticks);
			yield* TestClock.adjust(5000);
			expect(shown).toHaveLength(7);
		}),
);
