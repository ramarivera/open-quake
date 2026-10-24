import { Clock, Context, Effect, Ref, Schedule, Stream } from "effect";
import {
	type MetricSample,
	MODULES,
	type ModuleId,
	type MonitorSnapshot,
} from "./monitor-contracts.js";

export interface MetricCollector {
	readonly collect: (
		id: ModuleId,
	) => Effect.Effect<Omit<MetricSample, "id" | "collectedAt">>;
}
export class MonitorCollector extends Context.Tag("MonitorCollector")<
	MonitorCollector,
	MetricCollector
>() {}
/** One sequential worker per module. Slow modules cannot overlap or stall others. */
export class MonitorService extends Effect.Service<MonitorService>()(
	"MonitorService",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const collector = yield* MonitorCollector;
			return {
				watch: Effect.fn("MonitorService.watch")(function* (
					hz: number,
				): Effect.fn.Return<Stream.Stream<MonitorSnapshot>> {
					const interval = 1000 / hz;
					const state = yield* Ref.make(new Map<ModuleId, MetricSample>());
					const worker = (id: ModuleId) =>
						Effect.forever(
							Effect.gen(function* () {
								const result = yield* collector.collect(id);
								const collectedAt = yield* Clock.currentTimeMillis;
								yield* Ref.update(state, (old) =>
									new Map(old).set(id, { id, ...result, collectedAt }),
								);
								yield* Effect.sleep(interval);
							}),
						);
					return Stream.unwrapScoped(
						Effect.gen(function* () {
							for (const id of MODULES) yield* Effect.forkScoped(worker(id));
							return Stream.repeatEffect(
								Effect.gen(function* () {
									const now = yield* Clock.currentTimeMillis;
									const current = yield* Ref.get(state);
									return {
										sampledAt: now,
										samples: MODULES.map((id) => {
											const sample = current.get(id);
											if (!sample)
												return {
													id,
													state: "unavailable" as const,
													collectedAt: 0,
													values: {},
												};
											return sample.state === "available" &&
												now - sample.collectedAt >= interval * 3
												? { ...sample, state: "stale" as const }
												: sample;
										}),
									};
								}),
							).pipe(Stream.schedule(Schedule.spaced(interval)));
						}),
					);
				}),
			};
		}),
	},
) {}
