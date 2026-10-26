import { Clock, Context, Effect, Ref, Schedule, Schema, Stream } from "effect";
import { MetricSelection } from "./monitor-config.js";
import {
	type MetricSample,
	MODULES,
	type ModuleId,
	type MonitorSnapshot,
	SampleRate,
} from "./monitor-contracts.js";
import { MonitorConfigInvalid } from "./monitor-errors.js";

export interface MetricCollector {
	readonly collect: (
		id: ModuleId,
	) => Effect.Effect<Omit<MetricSample, "id" | "collectedAt">>;
}
export class MonitorCollector extends Context.Tag("MonitorCollector")<
	MonitorCollector,
	MetricCollector
>() {}
interface CollectionState {
	readonly attempt: MetricSample;
	readonly valid?: MetricSample;
}
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
					metrics: readonly ModuleId[] = MODULES,
				): Effect.fn.Return<
					Stream.Stream<MonitorSnapshot>,
					MonitorConfigInvalid
				> {
					if (
						!Schema.is(SampleRate)(hz) ||
						!Schema.is(MetricSelection)(metrics)
					)
						return yield* new MonitorConfigInvalid();
					const interval = 1000 / hz;
					const state = yield* Ref.make(new Map<ModuleId, CollectionState>());
					const worker = (id: ModuleId) =>
						Effect.forever(
							Effect.gen(function* () {
								const result = yield* collector.collect(id);
								const collectedAt = yield* Clock.currentTimeMillis;
								yield* Ref.update(state, (old) => {
									const attempt = { id, ...result, collectedAt };
									const valid =
										result.state === "available" ? attempt : old.get(id)?.valid;
									return new Map(old).set(id, {
										attempt,
										...(valid ? { valid } : {}),
									});
								});
								yield* Effect.sleep(interval);
							}),
						);
					return Stream.unwrapScoped(
						Effect.gen(function* () {
							for (const id of metrics) yield* Effect.forkScoped(worker(id));
							return Stream.repeatEffect(
								Effect.gen(function* () {
									const now = yield* Clock.currentTimeMillis;
									const current = yield* Ref.get(state);
									return {
										sampledAt: now,
										samples: MODULES.map((id) => {
											const entry = current.get(id);
											if (!entry)
												return {
													id,
													state: "unavailable" as const,
													collectedAt: 0,
													values: {},
												};
											const sample = entry.valid ?? entry.attempt;
											return {
												...sample,
												state:
													entry.valid &&
													now - sample.collectedAt >= interval * 3
														? ("stale" as const)
														: entry.attempt.state,
											};
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
