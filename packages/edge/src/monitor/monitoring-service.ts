import {
	Clock,
	Context,
	Effect,
	Fiber,
	Option,
	Schema,
	Stream,
	SubscriptionRef,
} from "effect";
import {
	effectiveMonitoring,
	type ForegroundSnapshot,
	type ForegroundWindow,
	MonitoringConfig,
	type MonitoringSnapshot,
} from "./monitor-config.js";
import { emptySnapshot } from "./monitor-contracts.js";
import {
	MonitorCollectionFailed,
	MonitorConfigInvalid,
	type MonitorPermissionDenied,
} from "./monitor-errors.js";
import { MonitorService } from "./monitor-service.js";

export class MonitorForeground extends Context.Tag("MonitorForeground")<
	MonitorForeground,
	{
		readonly pollMillis: number;
		readonly stop: () => Effect.Effect<void, MonitorCollectionFailed>;
		readonly query: () => Effect.Effect<
			Option.Option<ForegroundWindow>,
			MonitorCollectionFailed | MonitorPermissionDenied
		>;
	}
>() {}
const disabledForeground = (): ForegroundSnapshot => ({
	state: "disabled",
	collectedAt: 0,
});

/** One owned pair of workers fans out to every subscriber. Subscriptions never start collectors. */
export class MonitoringService extends Effect.Service<MonitoringService>()(
	"MonitoringService",
	{
		accessors: true,
		dependencies: [MonitorService.Default],
		scoped: Effect.gen(function* () {
			const sampler = yield* MonitorService;
			const foreground = yield* MonitorForeground;
			const scope = yield* Effect.scope;
			const state = yield* SubscriptionRef.make<MonitoringSnapshot>({
				metrics: emptySnapshot(),
				foreground: disabledForeground(),
			});
			const lock = yield* Effect.makeSemaphore(1);
			let metricWorker:
				| Fiber.RuntimeFiber<void, MonitorConfigInvalid>
				| undefined;
			let appWorker: Fiber.RuntimeFiber<void> | undefined;
			let metricKey = "",
				appEnabled = false,
				closed = false;
			let generation = 0,
				appGeneration = 0;
			const stopMetrics = Effect.gen(function* () {
				generation++;
				if (metricWorker) yield* Fiber.interrupt(metricWorker);
				metricWorker = undefined;
			});
			const stopApp = Effect.gen(function* () {
				appGeneration++;
				if (appWorker) yield* Fiber.interrupt(appWorker);
				appWorker = undefined;
				yield* foreground
					.stop()
					.pipe(
						Effect.catchTag("MonitorCollectionFailed", (error) =>
							Effect.logWarning("Foreground monitoring cleanup failed", error),
						),
					);
			});
			yield* Effect.addFinalizer(() =>
				lock.withPermits(1)(
					Effect.gen(function* () {
						closed = true;
						yield* stopMetrics;
						yield* stopApp;
					}),
				),
			);
			return {
				snapshot: Effect.fn("MonitoringService.snapshot")(
					(): Effect.Effect<MonitoringSnapshot> => SubscriptionRef.get(state),
				),
				subscribe: Effect.fn("MonitoringService.subscribe")(
					(): Effect.Effect<Stream.Stream<MonitoringSnapshot>> =>
						Effect.succeed(state.changes),
				),
				configure: Effect.fn("MonitoringService.configure")(
					(
						input: MonitoringConfig,
						demand: boolean,
					): Effect.Effect<void, MonitorConfigInvalid> =>
						lock.withPermits(1)(
							Effect.gen(function* () {
								const config = yield* Schema.decodeUnknown(MonitoringConfig)(
									input,
								).pipe(
									Effect.mapError((cause) => new MonitorConfigInvalid(cause)),
								);
								if (closed) return;
								const effective = effectiveMonitoring(config);
								const collect =
									demand && effective.enabled && effective.metrics.length > 0;
								const key = collect
									? JSON.stringify([effective.hz, effective.metrics])
									: "";
								if (metricKey !== key) {
									yield* stopMetrics;
									metricKey = key;
									yield* SubscriptionRef.update(state, (current) => ({
										...current,
										metrics: emptySnapshot(),
									}));
									if (collect) {
										const requested = generation;
										metricWorker = yield* sampler
											.watch(effective.hz, effective.metrics)
											.pipe(
												Effect.flatMap((stream) =>
													Stream.runForEach(stream, (metrics) =>
														requested === generation && !closed
															? SubscriptionRef.update(state, (current) => ({
																	...current,
																	metrics,
																}))
															: Effect.void,
													),
												),
												Effect.interruptible,
												Effect.forkIn(scope),
											);
									}
								}
								if (appEnabled !== effective.appEnabled) {
									yield* stopApp;
									appEnabled = effective.appEnabled;
									yield* SubscriptionRef.update(state, (current) => ({
										...current,
										foreground: appEnabled
											? { state: "unavailable" as const, collectedAt: 0 }
											: disabledForeground(),
									}));
									if (appEnabled) {
										const requested = appGeneration;
										appWorker = yield* Effect.forever(
											Effect.gen(function* () {
												const result = yield* foreground.query().pipe(
													Effect.timeoutFail({
														duration: "5 seconds",
														onTimeout: () => new MonitorCollectionFailed(),
													}),
													Effect.map((window) => ({
														state: Option.isSome(window)
															? ("available" as const)
															: ("unavailable" as const),
														...(Option.isSome(window)
															? { window: window.value }
															: {}),
													})),
													Effect.catchTags({
														MonitorCollectionFailed: (error) =>
															Effect.logWarning(
																"Foreground monitoring failed",
																error,
															).pipe(Effect.as({ state: "error" as const })),
														MonitorPermissionDenied: (error) =>
															Effect.logWarning(
																"Foreground monitoring permission denied",
																error,
															).pipe(
																Effect.as({
																	state: "permission-denied" as const,
																}),
															),
													}),
												);
												const collectedAt = yield* Clock.currentTimeMillis;
												if (requested === appGeneration && !closed)
													yield* SubscriptionRef.update(state, (current) => ({
														...current,
														foreground: { ...result, collectedAt },
													}));
												yield* Effect.sleep(
													Math.max(500, foreground.pollMillis),
												);
											}),
										).pipe(Effect.interruptible, Effect.forkIn(scope));
									}
								}
							}).pipe(Effect.uninterruptible),
						),
				),
			};
		}),
	},
) {}
