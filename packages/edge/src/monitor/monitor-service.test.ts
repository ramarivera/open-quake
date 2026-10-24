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
import { type MonitorSnapshot, SampleRate } from "./monitor-contracts.js";
import { MonitorCollector, MonitorService } from "./monitor-service.js";

describe("monitor sampling", () => {
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
				const started = yield* Deferred.make<void>();
				const latest = yield* Ref.make<MonitorSnapshot>({
					sampledAt: 0,
					samples: [],
				});
				const layer = MonitorService.Default.pipe(
					Layer.provide(
						Layer.succeed(MonitorCollector, {
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
				yield* TestClock.adjust(10000);
				expect(yield* Ref.get(cpuCalls)).toBe(2);
			}),
	);
});
