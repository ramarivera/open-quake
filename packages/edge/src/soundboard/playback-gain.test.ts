import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Scope, TestClock } from "effect";
import { expect } from "vitest";
import { makeSoundGain } from "./playback-gain.js";

it.scoped(
	"concurrent successor ramps wait for an interrupted native write's finalizer",
	() =>
		Effect.gen(function* () {
			const scope = yield* Scope.Scope;
			const entered = yield* Deferred.make<void>();
			const done = yield* Deferred.make<void>();
			const writes: number[] = [];
			let gain = 0;
			const ramp = yield* makeSoundGain({
				scope,
				current: () => true,
				read: () => gain,
				write: (value) =>
					Effect.suspend(() => {
						writes.push(value);
						return writes.length === 1
							? Deferred.succeed(entered, undefined).pipe(
									Effect.zipRight(Effect.never),
									Effect.ensuring(Deferred.await(done)),
								)
							: Effect.sync(() => {
									gain = value;
								});
					}),
			});
			const first = yield* ramp.to(1, 1000).pipe(Effect.fork);
			yield* Deferred.await(entered);
			const second = yield* ramp.to(0.5, 0).pipe(Effect.fork);
			const last = yield* ramp.to(0.8, 0).pipe(Effect.fork);
			yield* TestClock.adjust(1);
			expect(writes).toHaveLength(1);
			yield* Deferred.succeed(done, undefined);
			expect(yield* Fiber.join(first)).toBe(false);
			yield* Fiber.join(second);
			expect(yield* Fiber.join(last)).toBe(true);
			expect(gain).toBe(0.8);
			expect(writes.at(-1)).toBe(0.8);
		}),
);
