import { expect, it } from "@effect/vitest";
import { Clock, Deferred, Effect, Fiber, TestClock } from "effect";
import { brightnessController } from "./controller";

it.effect(
	"MAIN-074 writes at 1ms, eases at 16ms, and throttles the next burst to 500ms",
	() =>
		Effect.gen(function* () {
			let percent = 50;
			const writes: { at: number; value: number }[] = [];
			const step = brightnessController({
				smooth: true,
				read: Effect.sync(() => ({ target: "test", percent, quantum: 0.01 })),
				write: (_, value) =>
					Effect.gen(function* () {
						writes.push({ at: yield* Clock.currentTimeMillis, value });
						percent = value;
					}),
			});
			const first = yield* Effect.fork(step(1));
			yield* TestClock.adjust(0);
			expect(writes).toHaveLength(0);
			yield* TestClock.adjust(1);
			expect(writes[0]).toEqual({ at: 1, value: 51 });
			yield* TestClock.adjust(16);
			expect(writes[1]?.at).toBe(17);
			expect(writes[1]?.value).toBeCloseTo(51.8);
			yield* TestClock.adjust(300);
			yield* Fiber.join(first);
			expect(percent).toBe(55);
			const second = yield* Effect.fork(
				Effect.all([step(1), step(1)], { concurrency: "unbounded" }),
			);
			const count = writes.length;
			yield* TestClock.adjust(183);
			expect(writes).toHaveLength(count);
			yield* TestClock.adjust(1);
			expect(writes.at(-1)?.at).toBe(501);
			yield* TestClock.adjust(500);
			yield* Fiber.join(second);
			expect(percent).toBe(65);
		}),
);
it.effect(
	"MAIN-074 excludes an interrupted follower from an active burst before native writes",
	() =>
		Effect.gen(function* () {
			let percent = 50;
			const writes: number[] = [];
			const reading = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const step = brightnessController({
				read: Deferred.succeed(reading, undefined).pipe(
					Effect.zipRight(Deferred.await(release)),
					Effect.map(() => ({ target: "test", percent, quantum: 1 })),
				),
				write: (_, value) =>
					Effect.sync(() => {
						writes.push(value);
						percent = value;
					}),
			});
			const first = yield* Effect.fork(step(1));
			const second = yield* Effect.fork(step(1));
			yield* Deferred.await(reading);
			yield* Fiber.interrupt(second);
			yield* Deferred.succeed(release, undefined);
			yield* TestClock.adjust(1);
			yield* Fiber.join(first);
			expect(writes).toEqual([55]);
		}),
);
it.effect(
	"MAIN-074 canceling a leader releases every pending waiter without a late native write",
	() =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			let blocked = true,
				writes = 0;
			const step = brightnessController({
				read: Effect.suspend(() =>
					blocked
						? Deferred.succeed(started, undefined).pipe(
								Effect.zipRight(Effect.never),
							)
						: Effect.succeed({ target: "test", percent: 50, quantum: 1 }),
				),
				write: () =>
					Effect.sync(() => {
						writes++;
					}),
			});
			const first = yield* Effect.fork(step(1));
			yield* Deferred.await(started);
			const second = yield* Effect.fork(Effect.either(step(1)));
			yield* Effect.yieldNow();
			yield* Fiber.interrupt(first);
			expect((yield* Fiber.join(second))._tag).toBe("Left");
			expect(writes).toBe(0);
			blocked = false;
		}),
);
