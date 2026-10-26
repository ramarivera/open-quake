import { describe, expect, it } from "@effect/vitest";
import {
	Context,
	Deferred,
	Effect,
	Exit,
	Layer,
	Option,
	Ref,
	Schema,
	Scope,
	Stream,
	TestClock,
} from "effect";
import fc from "fast-check";
import {
	effectiveMonitoring,
	MonitoringConfig,
	type MonitoringSnapshot,
	monitoringDefaults,
} from "./monitor-config.js";
import type { ModuleId } from "./monitor-contracts.js";
import {
	MonitorCollectionFailed,
	MonitorPermissionDenied,
} from "./monitor-errors.js";
import { type MetricCollector, MonitorCollector } from "./monitor-service.js";
import { MonitorForeground, MonitoringService } from "./monitoring-service.js";

const makeLayer = (
	collector: MetricCollector,
	foreground: MonitorForeground["Type"]["query"] = () =>
		Effect.succeed(Option.none()),
) =>
	MonitoringService.Default.pipe(
		Layer.provide(Layer.succeed(MonitorCollector, collector)),
		Layer.provide(
			Layer.succeed(MonitorForeground, {
				query: foreground,
				stop: () => Effect.void,
				pollMillis: 2000,
			}),
		),
	);
const available: MetricCollector = {
	collect: () => Effect.succeed({ state: "available", values: { load: 17 } }),
};

describe("shared monitoring lifecycle", () => {
	it("restores latest normal settings for arbitrary valid rates without changing the input", () => {
		fc.assert(
			fc.property(fc.double({ min: 0.2, max: 10, noNaN: true }), (hz) => {
				const config = {
					...monitoringDefaults(),
					hz,
					metrics: ["memory" as const],
					override: { active: true, hz: 2, metrics: ["cpu" as const] },
				};
				expect(effectiveMonitoring(config)).toMatchObject({
					hz: 2,
					metrics: ["cpu"],
				});
				expect(
					effectiveMonitoring({
						...config,
						override: { ...config.override, active: false },
					}),
				).toMatchObject({ hz, metrics: ["memory"] });
				expect(config.hz).toBe(hz);
				expect(
					Schema.decodeUnknownSync(MonitoringConfig)(
						Schema.encodeSync(MonitoringConfig)(config),
					),
				).toEqual(config);
			}),
		);
		for (const patch of [
			{ hz: 0 },
			{ hz: 11 },
			{ metrics: ["cpu", "cpu"] },
			{ method: "shell" },
			{ override: { active: true, hz: Infinity, metrics: [] } },
		])
			expect(
				Schema.is(MonitoringConfig)({ ...monitoringDefaults(), ...patch }),
			).toBe(false);
	});
	it.scoped(
		"shares one metric worker across subscribers and ignores normal edits during override",
		() =>
			Effect.gen(function* () {
				const calls = yield* Ref.make<ModuleId[]>([]);
				const layer = makeLayer({
					collect: (id) =>
						Ref.update(calls, (ids) => [...ids, id]).pipe(
							Effect.as({ state: "available" as const, values: { load: 17 } }),
						),
				});
				yield* Effect.gen(function* () {
					const service = yield* MonitoringService;
					const one = yield* Ref.make<MonitoringSnapshot[]>([]),
						two = yield* Ref.make<MonitoringSnapshot[]>([]);
					for (const target of [one, two])
						yield* service.subscribe().pipe(
							Effect.flatMap((stream) =>
								Stream.runForEach(stream, (value) =>
									Ref.update(target, (all) => [...all, value]),
								),
							),
							Effect.forkScoped,
						);
					const config = {
						...monitoringDefaults(),
						override: { active: true, hz: 1, metrics: ["cpu" as const] },
					};
					yield* service.configure(config, true);
					yield* TestClock.adjust(1000);
					expect(yield* Ref.get(calls)).toEqual(["cpu", "cpu"]);
					yield* service.configure(
						{ ...config, hz: 5, metrics: ["memory"] },
						true,
					);
					yield* TestClock.adjust(1000);
					expect(yield* Ref.get(calls)).toEqual(["cpu", "cpu", "cpu"]);
					expect((yield* Ref.get(one)).at(-1)).toEqual(
						(yield* Ref.get(two)).at(-1),
					);
					yield* service.configure(
						{
							...config,
							hz: 5,
							metrics: ["memory"],
							override: { ...config.override, active: false },
						},
						true,
					);
					yield* TestClock.adjust(400);
					expect(
						(yield* Ref.get(calls)).filter((id) => id === "cpu"),
					).toHaveLength(3);
					expect(
						(yield* Ref.get(calls)).filter((id) => id === "memory").length,
					).toBeGreaterThanOrEqual(2);
					yield* service.configure({ ...config, enabled: false }, true);
					const count = (yield* Ref.get(calls)).length;
					yield* TestClock.adjust(5000);
					expect((yield* Ref.get(calls)).length).toBe(count);
					expect(
						(yield* service.snapshot()).metrics.samples.every(
							(sample) => sample.state === "unavailable",
						),
					).toBe(true);
				}).pipe(Effect.provide(layer));
			}),
	);
	it.scoped(
		"disable interrupts pending foreground and metrics, drops old results, and shutdown releases owners",
		() =>
			Effect.gen(function* () {
				const cpuStarted = yield* Deferred.make<void>(),
					appStarted = yield* Deferred.make<void>();
				const released = yield* Ref.make<string[]>([]);
				const layer = makeLayer(
					{
						collect: () =>
							Deferred.succeed(cpuStarted, undefined).pipe(
								Effect.zipRight(Effect.never),
								Effect.ensuring(Ref.update(released, (ids) => [...ids, "cpu"])),
							),
					},
					() =>
						Deferred.succeed(appStarted, undefined).pipe(
							Effect.zipRight(Effect.never),
							Effect.ensuring(Ref.update(released, (ids) => [...ids, "app"])),
						),
				);
				const owner = yield* Scope.make();
				const service = yield* Effect.provideService(
					Layer.build(layer),
					Scope.Scope,
					owner,
				).pipe(
					Effect.map((context) => Context.get(context, MonitoringService)),
				);
				const config = {
					...monitoringDefaults(),
					metrics: ["cpu" as const],
					appMonitor: { enabled: true },
				};
				yield* service.configure(config, true);
				yield* Deferred.await(cpuStarted);
				yield* Deferred.await(appStarted);
				yield* service.configure({ ...config, enabled: false }, true);
				expect((yield* Ref.get(released)).sort()).toEqual(["app", "cpu"]);
				expect((yield* service.snapshot()).foreground).toEqual({
					state: "disabled",
					collectedAt: 0,
				});
				yield* Scope.close(owner, Exit.void);
				yield* TestClock.adjust(10000);
				expect((yield* Ref.get(released)).sort()).toEqual(["app", "cpu"]);
			}),
	);
	it.scoped(
		"foreground errors leave metric monitoring usable, then recover",
		() =>
			Effect.gen(function* () {
				const attempts = yield* Ref.make(0);
				yield* Effect.gen(function* () {
					const service = yield* MonitoringService;
					yield* service.configure(
						{
							...monitoringDefaults(),
							metrics: ["memory"],
							appMonitor: { enabled: true },
						},
						true,
					);
					yield* TestClock.adjust(1000);
					expect((yield* service.snapshot()).foreground.state).toBe(
						"permission-denied",
					);
					yield* TestClock.adjust(2000);
					expect((yield* service.snapshot()).foreground.state).toBe("error");
					expect(yield* service.snapshot()).toMatchObject({
						metrics: {
							samples: expect.arrayContaining([
								expect.objectContaining({ id: "memory", values: { load: 17 } }),
							]),
						},
					});
					yield* TestClock.adjust(2000);
					expect((yield* service.snapshot()).foreground.window).toEqual({
						id: "42",
						path: "/private/app",
					});
					yield* service.configure(
						{
							...monitoringDefaults(),
							metrics: ["memory"],
							appMonitor: { enabled: false },
						},
						true,
					);
					expect((yield* service.snapshot()).foreground.window).toBeUndefined();
				}).pipe(
					Effect.provide(
						makeLayer(available, () =>
							Ref.updateAndGet(attempts, (n) => n + 1).pipe(
								Effect.flatMap(
									(n): ReturnType<MonitorForeground["Type"]["query"]> =>
										n === 1
											? Effect.fail(
													new MonitorPermissionDenied(
														new Error("token=secret"),
													),
												)
											: n === 2
												? Effect.fail(new MonitorCollectionFailed())
												: Effect.succeed(
														Option.some({ id: "42", path: "/private/app" }),
													),
								),
							),
						),
					),
				);
			}),
	);
	it.scoped(
		"times out a stuck foreground query without overlapping it or requiring a panel",
		() =>
			Effect.gen(function* () {
				const started = yield* Ref.make(0),
					released = yield* Ref.make(0);
				yield* Effect.gen(function* () {
					const service = yield* MonitoringService;
					yield* service.configure(
						{ ...monitoringDefaults(), appMonitor: { enabled: true } },
						false,
					);
					yield* TestClock.adjust(5000);
					expect(yield* Ref.get(started)).toBe(1);
					expect(yield* Ref.get(released)).toBe(1);
					expect((yield* service.snapshot()).foreground.state).toBe("error");
					yield* TestClock.adjust(2000);
					expect(yield* Ref.get(started)).toBe(2);
				}).pipe(
					Effect.provide(
						makeLayer(available, () =>
							Ref.update(started, (n) => n + 1).pipe(
								Effect.zipRight(Effect.never),
								Effect.ensuring(Ref.update(released, (n) => n + 1)),
							),
						),
					),
				);
			}),
	);
	it("keeps typed permission identity and raw causes out of serialization", () => {
		const cause = new Error("token=secret /private/app");
		const error = new MonitorPermissionDenied(cause);
		expect(error.code).toBe("QUAKE.MONITOR.PERMISSION_DENIED");
		expect(error.originalCause).toBe(cause);
		const decoded = Schema.decodeUnknownSync(MonitorPermissionDenied)(
			Schema.encodeSync(MonitorPermissionDenied)(error),
		);
		expect(decoded.code).toBe(error.code);
		expect(decoded.diagnosticCause).toEqual(error.diagnosticCause);
		expect(decoded.originalCause).toBeUndefined();
		expect(JSON.stringify(error)).not.toContain("secret");
		expect(JSON.stringify(error)).not.toContain("/private/app");
	});
});
