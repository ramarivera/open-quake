import { Deferred, Effect, Either, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import {
	KnobCapabilityUnavailable,
	KnobSessionStale,
} from "../../../../../../packages/device/src/knob/knob-errors.js";
import {
	type BrightnessAdapter,
	type BrightnessReading,
	brightnessController,
} from "./controller";

const fixture = (percent = 50) => {
	let value: BrightnessReading = {
		target: "test-display",
		percent,
		quantum: 1,
	};
	const writes: number[] = [];
	const adapter: BrightnessAdapter = {
		read: Effect.sync(() => ({ ...value })),
		write: (_, next) =>
			Effect.sync(() => {
				writes.push(next);
				value = { ...value, percent: next };
			}),
	};
	return {
		adapter,
		writes,
		set: (next: Partial<BrightnessReading>) => {
			value = { ...value, ...next };
		},
	};
};
describe("host brightness controller", () => {
	it.each([
		[50, 1, 55],
		[50, -1, 45],
		[98, 1, 100],
		[2, -1, 0],
	] as const)(
		"steps and clamps %s by %s to %s",
		async (initial, delta, next) => {
			const h = fixture(initial);
			await Effect.runPromise(brightnessController(h.adapter)(delta));
			expect(h.writes).toEqual([next]);
		},
	);
	it.each([
		[100, 1],
		[0, -1],
	] as const)("doesn't write beyond a bound", async (initial, delta) => {
		const h = fixture(initial);
		await Effect.runPromise(brightnessController(h.adapter)(delta));
		expect(h.writes).toHaveLength(0);
	});
	it("retains every concurrent detent without lost read-modify-write updates", async () => {
		const h = fixture();
		const step = brightnessController({
			...h.adapter,
			read: Effect.yieldNow().pipe(Effect.zipRight(h.adapter.read)),
		});
		await Effect.runPromise(
			Effect.all(
				Array.from({ length: 8 }, () => step(1)),
				{ concurrency: "unbounded" },
			),
		);
		expect(h.writes).toEqual([90]);
	});
	it("doesn't write after failed or invalid reads", async () => {
		for (const reading of [
			{ percent: NaN },
			{ percent: 101 },
			{ target: "" },
			{ quantum: 0 },
		]) {
			const h = fixture();
			h.set(reading);
			const result = await Effect.runPromise(
				Effect.either(brightnessController(h.adapter)(1)),
			);
			expect(Either.isLeft(result) && result.left._tag).toBe(
				"KnobDispatchFailed",
			);
			expect(h.writes).toHaveLength(0);
		}
		const h = fixture();
		const source = KnobCapabilityUnavailable.fromCause();
		const result = await Effect.runPromise(
			Effect.either(
				brightnessController({ ...h.adapter, read: Effect.fail(source) })(1),
			),
		);
		expect(Either.isLeft(result) && result.left.code).toBe(source.code);
		expect(Either.isLeft(result) && result.left._tag).toBe(source._tag);
		expect(h.writes).toHaveLength(0);
	});
	it("rechecks committed ownership after native reading", async () => {
		const h = fixture();
		let valid = true;
		const step = brightnessController({
			...h.adapter,
			read: h.adapter.read.pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						valid = false;
					}),
				),
			),
		});
		const guard = Effect.suspend(() =>
			valid ? Effect.void : Effect.fail(KnobSessionStale.fromCause()),
		);
		const result = await Effect.runPromise(Effect.either(step(1, guard)));
		expect(Either.isLeft(result) && result.left._tag).toBe("KnobSessionStale");
		expect(h.writes).toHaveLength(0);
	});
	it.each(["wrong-value", "changed-target"])(
		"refuses unconfirmed success: %s",
		async (kind) => {
			const h = fixture();
			const result = await Effect.runPromise(
				Effect.either(
					brightnessController({
						...h.adapter,
						write: () =>
							Effect.sync(() => {
								if (kind === "changed-target")
									h.set({ target: "replacement", percent: 55 });
							}),
					})(1),
				),
			);
			expect(Either.isLeft(result) && result.left._tag).toBe(
				"KnobDispatchFailed",
			);
		},
	);
	it("doesn't accept unchanged coarse hardware as a successful detent", async () => {
		const h = fixture(0);
		h.set({ quantum: 100 });
		const adapter = { ...h.adapter, write: () => Effect.void };
		const result = await Effect.runPromise(
			Effect.either(brightnessController(adapter)(1)),
		);
		expect(Either.isLeft(result) && result.left._tag).toBe(
			"KnobDispatchFailed",
		);
	});

	it("cancels a pending read and releases the lock without a late write", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const h = fixture();
				let blocked = true;
				const step = brightnessController({
					...h.adapter,
					read: Effect.suspend(() =>
						blocked
							? Deferred.succeed(started, undefined).pipe(
									Effect.zipRight(Deferred.await(release)),
									Effect.zipRight(h.adapter.read),
								)
							: h.adapter.read,
					),
				});
				const fiber = yield* Effect.fork(step(1));
				yield* Deferred.await(started);
				yield* Fiber.interrupt(fiber);
				blocked = false;
				yield* Deferred.succeed(release, undefined);
				expect(h.writes).toHaveLength(0);
				yield* step(-1);
				expect(h.writes).toEqual([45]);
			}),
		);
	});
	it("validates a queued request again after the previous owner releases the lock", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const h = fixture();
				let valid = true;
				const step = brightnessController({
					...h.adapter,
					write: (before, next) =>
						Deferred.succeed(started, undefined).pipe(
							Effect.zipRight(Deferred.await(release)),
							Effect.zipRight(h.adapter.write(before, next)),
						),
				});
				const first = yield* Effect.fork(step(1));
				yield* Deferred.await(started);
				const guard = Effect.suspend(() =>
					valid ? Effect.void : Effect.fail(KnobSessionStale.fromCause()),
				);
				const second = yield* Effect.fork(Effect.either(step(1, guard)));
				valid = false;
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(first);
				const result = yield* Fiber.join(second);
				expect(Either.isLeft(result) && result.left._tag).toBe(
					"KnobSessionStale",
				);
				expect(h.writes).toEqual([55]);
			}),
		);
	});
});
