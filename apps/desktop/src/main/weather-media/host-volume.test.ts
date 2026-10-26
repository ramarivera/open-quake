import { expect, it } from "@effect/vitest";
import { Effect, Fiber, TestClock } from "effect";
import { makeHostVolume } from "./host-volume";

it.scoped(
	"MAIN-073 MAIN-089 MGMT-168/377 shares fresh mute and bounded writes with one unarmed observer",
	() =>
		Effect.gen(function* () {
			let state = { level: 100, muted: false },
				reads = 0;
			const writes: (typeof state)[] = [];
			const owner = yield* makeHostVolume({
				read: Effect.sync(() => {
					reads++;
					return { ...state };
				}),
				write: (value) =>
					Effect.sync(() => {
						writes.push(value);
						state = { ...value };
					}),
			});
			const first: (typeof state)[] = [],
				second: (typeof state)[] = [];
			const offA = owner.observe((s) => first.push(s)),
				offB = owner.observe((s) => second.push(s));
			yield* TestClock.adjust(2000);
			expect(reads).toBe(1);
			expect(first).toEqual(second);
			state = { level: 0, muted: true };
			yield* TestClock.adjust(2000);
			expect(first.at(-1)).toEqual(state);
			yield* owner.command("audio_vol_down");
			expect(writes).toHaveLength(0);
			yield* owner.command("audio_vol_up");
			expect(writes.at(-1)).toEqual({ level: 1, muted: false });
			state = { level: 90, muted: true };
			yield* owner.command("audio_mute");
			expect(writes.at(-1)).toEqual({ level: 90, muted: false });
			offA();
			offB();
			const before = reads;
			yield* TestClock.adjust(6000);
			expect(reads).toBe(before);
		}),
);
it.scoped(
	"MGMT-167/376 serializes concurrent commands without losing a detent",
	() =>
		Effect.gen(function* () {
			let state = { level: 98, muted: false };
			const owner = yield* makeHostVolume({
				read: Effect.sync(() => state),
				write: (value) =>
					Effect.yieldNow().pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								state = value;
							}),
						),
					),
			});
			const jobs = yield* Effect.fork(
				Effect.all(
					[
						owner.command("audio_vol_up"),
						owner.command("audio_vol_up"),
						owner.command("audio_vol_up"),
					],
					{ concurrency: "unbounded" },
				),
			);
			yield* Fiber.join(jobs);
			expect(state).toEqual({ level: 100, muted: false });
		}),
);
