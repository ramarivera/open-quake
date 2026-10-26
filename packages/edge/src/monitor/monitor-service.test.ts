import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Fiber,
	Layer,
	Ref,
	Schema,
	Stream,
	TestClock,
} from "effect";
import fc from "fast-check";
import {
	type MetricSample,
	type MonitorSnapshot,
	SampleRate,
} from "./monitor-contracts.js";
import { MonitorCollector, MonitorService } from "./monitor-service.js";

describe("monitor sampling", () => {
	it.scoped(
		"retains successful readings and their age across failed attempts, then recovers",
		() =>
			Effect.gen(function* () {
				const latest = yield* Ref.make<MonitorSnapshot>({
					sampledAt: 0,
					samples: [],
				});
				const attempt = yield* Ref.make(0);
				const failuresAllowed = yield* Deferred.make<void>();
				const started = yield* Deferred.make<void>();
				const failures: readonly MetricSample["state"][] = [
					"error",
					"permission-denied",
					"unavailable",
				];
				const layer = MonitorService.Default.pipe(
					Layer.provide(
						Layer.succeed(MonitorCollector, {
							collect: (id) =>
								id === "cpu"
									? Effect.gen(function* () {
											const n = yield* Ref.updateAndGet(attempt, (n) => n + 1);
											if (n === 1) yield* Deferred.succeed(started, undefined);
											if (n > 1) yield* Deferred.await(failuresAllowed);
											return {
												state:
													n === 1 || n >= 5
														? ("available" as const)
														: (failures[n - 2] ?? "error"),
												values:
													n === 1 ? { load: 37 } : n >= 5 ? { load: 51 } : {},
											};
										})
									: Effect.succeed({
											state: "permission-denied" as const,
											values: {},
										}),
						}),
					),
				);
				const fiber = yield* MonitorService.watch(1).pipe(
					Effect.flatMap((stream) =>
						Stream.runForEach(stream, (value) => Ref.set(latest, value)),
					),
					Effect.provide(layer),
					Effect.forkScoped,
				);
				yield* Deferred.await(started);
				yield* TestClock.adjust(2000);
				const original = (yield* Ref.get(latest)).samples.find(
					(s) => s.id === "cpu",
				);
				expect(original).toMatchObject({
					state: "available",
					values: { load: 37 },
				});
				yield* Deferred.succeed(failuresAllowed, undefined);
				yield* TestClock.adjust(2000);
				const stale = (yield* Ref.get(latest)).samples.find(
					(s) => s.id === "cpu",
				);
				expect(stale).toMatchObject({
					state: "stale",
					collectedAt: original?.collectedAt,
					values: { load: 37 },
				});
				expect(
					(yield* Ref.get(latest)).samples.find((s) => s.id === "memory"),
				).toMatchObject({ state: "permission-denied", values: {} });
				yield* TestClock.adjust(3000);
				const recovered = (yield* Ref.get(latest)).samples.find(
					(s) => s.id === "cpu",
				);
				expect(recovered).toMatchObject({
					state: "available",
					values: { load: 51 },
				});
				expect(recovered?.collectedAt).toBeGreaterThanOrEqual(5000);
				yield* Fiber.interrupt(fiber);
			}),
	);
	it("accepts only finite configured rates in range", () => {
		fc.assert(
			fc.property(
				fc.double({ noNaN: true }),
				(hz) =>
					Schema.is(SampleRate)(hz) ===
					(Number.isFinite(hz) && hz >= 0.2 && hz <= 10),
			),
		);
		expect([0, 11, Number.NaN].map(Schema.is(SampleRate))).toEqual([
			false,
			false,
			false,
		]);
	});
	it.scoped(
		"isolates slow collectors, marks stale and interrupts work on unmount",
		() =>
			Effect.gen(function* () {
				const cpuCalls = yield* Ref.make(0),
					cpuReleased = yield* Ref.make(0);
				let resets = 0;
				const started = yield* Deferred.make<void>();
				const latest = yield* Ref.make<MonitorSnapshot>({
					sampledAt: 0,
					samples: [],
				});
				const layer = MonitorService.Default.pipe(
					Layer.provide(
						Layer.succeed(MonitorCollector, {
							reset: Effect.sync(() => {
								resets++;
							}),
							collect: (id) =>
								id === "cpu"
									? Effect.gen(function* () {
											const calls = yield* Ref.updateAndGet(
												cpuCalls,
												(n) => n + 1,
											);
											if (calls === 1)
												return {
													state: "available" as const,
													values: { load: 37 },
												};
											yield* Deferred.succeed(started, undefined);
											return yield* Effect.never.pipe(
												Effect.ensuring(Ref.update(cpuReleased, (n) => n + 1)),
											);
										})
									: Effect.succeed({
											state:
												id === "gpu"
													? ("unsupported" as const)
													: ("available" as const),
											values: { total: 123 },
										}),
						}),
					),
				);
				const fiber = yield* MonitorService.watch(1).pipe(
					Effect.flatMap((stream) =>
						Stream.runForEach(stream, (value) => Ref.set(latest, value)),
					),
					Effect.provide(layer),
					Effect.forkScoped,
				);
				yield* TestClock.adjust(1000);
				yield* Deferred.await(started);
				yield* TestClock.adjust(4000);
				const snapshot = yield* Ref.get(latest);
				const cpu = snapshot.samples.find((sample) => sample.id === "cpu");
				expect(cpu).toMatchObject({ state: "stale", values: { load: 37 } });
				expect(
					snapshot.samples.find((sample) => sample.id === "gpu")?.state,
				).toBe("unsupported");
				expect(
					snapshot.samples.find((sample) => sample.id === "memory")?.state,
				).toBe("available");
				expect(yield* Ref.get(cpuCalls)).toBe(2);
				yield* Fiber.interrupt(fiber);
				expect(yield* Ref.get(cpuReleased)).toBe(1);
				expect(resets).toBe(2);
				yield* TestClock.adjust(10000);
				expect(yield* Ref.get(cpuCalls)).toBe(2);
			}),
	);
});

it.scoped(
	"expires retained values after sixty failed checks and cancels the old sampling stream",
	() =>
		Effect.gen(function* () {
			const latest = yield* Ref.make<MonitorSnapshot>({
				sampledAt: 0,
				samples: [],
			});
			let calls = 0;
			const layer = MonitorService.Default.pipe(
				Layer.provide(
					Layer.succeed(MonitorCollector, {
						collect: () =>
							Effect.sync(() => ({
								state:
									++calls === 1 ? ("available" as const) : ("error" as const),
								values: calls === 1 ? { load: 42 } : {},
							})),
					}),
				),
			);
			const f = yield* MonitorService.watch(1, ["cpu"]).pipe(
				Effect.flatMap((s) => Stream.runForEach(s, (v) => Ref.set(latest, v))),
				Effect.provide(layer),
				Effect.forkScoped,
			);
			yield* TestClock.adjust(59000);
			expect(
				(yield* Ref.get(latest)).samples.find((s) => s.id === "cpu"),
			).toMatchObject({ state: "stale", values: { load: 42 } });
			yield* TestClock.adjust(2000);
			expect(calls).toBeGreaterThanOrEqual(61);
			yield* TestClock.adjust(1000);
			expect(
				(yield* Ref.get(latest)).samples.find((s) => s.id === "cpu"),
			).toMatchObject({ state: "unavailable", values: {} });
			yield* Fiber.interrupt(f);
			const stopped = calls;
			yield* TestClock.adjust(5000);
			expect(calls).toBe(stopped);
		}),
);
