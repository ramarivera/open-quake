import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, TestClock } from "effect";
import { playbackWatchdog } from "./speech-watchdog";

for (const [duration, deadline] of [
	[0, 30000],
	[100, 8000],
] as const) {
	it.effect(`AI-156 duration ${duration} expires at ${deadline} ms`, () =>
		Effect.gen(function* () {
			let resumes = 0;
			const fiber = yield* playbackWatchdog(
				duration,
				() => Effect.succeed("running"),
				() =>
					Effect.sync(() => {
						resumes++;
					}),
			).pipe(Effect.either, Effect.fork);
			yield* TestClock.adjust(deadline - 1);
			expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);
			yield* TestClock.adjust(1);
			expect(yield* Fiber.join(fiber)).toMatchObject({
				_tag: "Left",
				left: { phase: "playback" },
			});
			expect(resumes).toBe(0);
		}),
	);
}

it.effect(
	"a hung renderer context probe still expires at the original deadline",
	() =>
		Effect.gen(function* () {
			const fiber = yield* playbackWatchdog(
				10000,
				() => Effect.never,
				() => Effect.die("unexpected resume"),
			).pipe(Effect.either, Effect.fork);
			yield* TestClock.adjust(14999);
			expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);
			yield* TestClock.adjust(1);
			expect(yield* Fiber.join(fiber)).toMatchObject({
				_tag: "Left",
				left: { phase: "playback" },
			});
		}),
);
