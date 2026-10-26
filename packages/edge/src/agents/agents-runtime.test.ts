import { describe, expect, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Fiber, Layer, TestClock } from "effect";
import type { RuntimeState } from "./agents-contracts.js";
import { AgentRuntimeFailed } from "./agents-errors.js";
import { type AgentRuntimeAdapter, AgentRuntimePort } from "./agents-ports.js";
import { AgentsRuntime } from "./agents-runtime.js";

const stopped: RuntimeState = {
	available: true,
	status: "stopped",
	code: "",
	operation: "none",
};
const port = (
	overrides: Partial<AgentRuntimeAdapter> = {},
): AgentRuntimeAdapter => ({
	available: true,
	initial: stopped,
	start: Effect.void,
	stop: Effect.void,
	restart: Effect.void,
	subscribe: () => () => {},
	...overrides,
});
describe("AgentsRuntime real lifecycle consumer", () => {
	it.effect(
		"disables an unavailable runtime and never calls its backend",
		() => {
			let calls = 0;
			return Effect.gen(function* () {
				const service = yield* AgentsRuntime;
				const result = yield* service.control("start").pipe(Effect.either);
				expect(result._tag === "Left" && result.left.code).toBe(
					"AGENT.RUNTIME.UNAVAILABLE",
				);
				expect((yield* service.read()).available).toBe(false);
				expect(calls).toBe(0);
			}).pipe(
				Effect.provide(
					AgentsRuntime.Default.pipe(
						Layer.provide(
							Layer.succeed(
								AgentRuntimePort,
								port({
									available: false,
									start: Effect.sync(() => {
										calls++;
									}),
								}),
							),
						),
					),
				),
			);
		},
	);
	it.effect(
		"publishes ready/error states, reuses ready state and unsubscribes on scope close",
		() => {
			const events: RuntimeState[] = [];
			let unsubscribed = false;
			return Effect.scoped(
				Effect.gen(function* () {
					const service = yield* AgentsRuntime;
					const off = service.subscribe((s) => events.push(s));
					yield* service.control("start");
					expect((yield* service.read()).status).toBe("ready");
					const duplicate = yield* service.control("start").pipe(Effect.either);
					expect(duplicate._tag).toBe("Right");
					const failed = yield* service.control("restart").pipe(Effect.either);
					expect(failed._tag === "Left" && failed.left.code).toBe(
						"AGENT.RUNTIME.FAILED",
					);
					expect((yield* service.read()).status).toBe("error");
					expect(events.map((s) => s.status)).toEqual([
						"starting",
						"ready",
						"starting",
						"error",
					]);
					off();
				}).pipe(
					Effect.provide(
						AgentsRuntime.Default.pipe(
							Layer.provide(
								Layer.succeed(
									AgentRuntimePort,
									port({
										restart: Effect.fail(new AgentRuntimeFailed()),
										subscribe: () => () => {
											unsubscribed = true;
										},
									}),
								),
							),
						),
					),
				),
			).pipe(
				Effect.tap(() => Effect.sync(() => expect(unsubscribed).toBe(true))),
			);
		},
	);
	it.effect(
		"reuses a ready backend without dispatching or publishing another start",
		() => {
			let starts = 0;
			return Effect.gen(function* () {
				const service = yield* AgentsRuntime;
				const events: RuntimeState[] = [];
				service.subscribe((state) => events.push(state));
				yield* service.control("start");
				const ready = yield* service.read();
				yield* service.control("start");
				expect(yield* service.read()).toBe(ready);
				expect(starts).toBe(1);
				expect(events.map((state) => state.status)).toEqual([
					"starting",
					"ready",
				]);
			}).pipe(
				Effect.provide(
					AgentsRuntime.Default.pipe(
						Layer.provide(
							Layer.succeed(
								AgentRuntimePort,
								port({
									start: Effect.sync(() => {
										starts++;
									}),
								}),
							),
						),
					),
				),
			);
		},
	);
	for (const action of ["start", "stop", "restart"] as const)
		it.effect(
			`${action} interruption cancels work, releases control ownership and allows recovery`,
			() =>
				Effect.gen(function* () {
					const entered = yield* Deferred.make<void>();
					let calls = 0;
					let cancelled = false;
					const operation = Effect.suspend(() => {
						calls++;
						return calls === 1
							? Deferred.succeed(entered, undefined).pipe(
									Effect.zipRight(Effect.never),
									Effect.ensuring(
										Effect.sync(() => {
											cancelled = true;
										}),
									),
								)
							: Effect.void;
					});
					yield* Effect.gen(function* () {
						const service = yield* AgentsRuntime;
						const running = yield* service.control(action).pipe(Effect.fork);
						yield* Deferred.await(entered);
						const conflict = yield* service.control(action).pipe(Effect.either);
						expect(conflict._tag === "Left" && conflict.left.code).toBe(
							"AGENT.RUNTIME.BUSY",
						);
						yield* Fiber.interrupt(running);
						expect(cancelled).toBe(true);
						expect(yield* service.read()).toMatchObject({
							status: "error",
							code: "AGENT.RUNTIME.FAILED",
							operation: action,
						});
						yield* service.control(action);
						expect(calls).toBe(2);
						expect((yield* service.read()).status).toBe(
							action === "stop" ? "stopped" : "ready",
						);
					}).pipe(
						Effect.provide(
							AgentsRuntime.Default.pipe(
								Layer.provide(
									Layer.succeed(
										AgentRuntimePort,
										port({
											initial:
												action === "start"
													? stopped
													: { ...stopped, status: "ready" },
											[action]: operation,
										}),
									),
								),
							),
						),
					);
				}),
		);
	it.effect(
		"preserves a backend-confirmed terminal state during interrupted cleanup",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				let notify: (state: RuntimeState) => void = () => {};
				yield* Effect.gen(function* () {
					const service = yield* AgentsRuntime;
					const running = yield* service.control("start").pipe(Effect.fork);
					yield* Deferred.await(entered);
					yield* Fiber.interrupt(running);
					expect(yield* service.read()).toEqual(stopped);
					yield* service.control("stop");
				}).pipe(
					Effect.provide(
						AgentsRuntime.Default.pipe(
							Layer.provide(
								Layer.succeed(
									AgentRuntimePort,
									port({
										start: Deferred.succeed(entered, undefined).pipe(
											Effect.zipRight(Effect.never),
											Effect.ensuring(Effect.sync(() => notify(stopped))),
										),
										subscribe: (listener) => {
											notify = listener;
											return () => {};
										},
										stop: Effect.die(
											"already stopped backend must not receive stop",
										),
									}),
								),
							),
						),
					),
				);
			}),
	);

	for (const status of ["starting", "stopping"] as const)
		it.effect(
			`does not replace an external ${status} transition when rejecting a control`,
			() =>
				Effect.gen(function* () {
					const service = yield* AgentsRuntime;
					const before = yield* service.read();
					for (const action of ["start", "stop", "restart"] as const) {
						const rejected = yield* service.control(action).pipe(Effect.either);
						expect(rejected._tag === "Left" && rejected.left.code).toBe(
							"AGENT.RUNTIME.BUSY",
						);
						expect(yield* service.read()).toBe(before);
					}
				}).pipe(
					Effect.provide(
						AgentsRuntime.Default.pipe(
							Layer.provide(
								Layer.succeed(
									AgentRuntimePort,
									port({ initial: { ...stopped, status } }),
								),
							),
						),
					),
				),
		);
	it.effect(
		"releases ownership and reports an unconfirmed transition after an adapter defect",
		() => {
			let calls = 0;
			return Effect.gen(function* () {
				const service = yield* AgentsRuntime;
				const result = yield* service.control("start").pipe(Effect.exit);
				expect(result._tag).toBe("Failure");
				expect(yield* service.read()).toMatchObject({
					status: "error",
					code: "AGENT.RUNTIME.FAILED",
				});
				yield* service.control("start");
				expect((yield* service.read()).status).toBe("ready");
				expect(calls).toBe(2);
			}).pipe(
				Effect.provide(
					AgentsRuntime.Default.pipe(
						Layer.provide(
							Layer.succeed(
								AgentRuntimePort,
								port({
									start: Effect.suspend(() =>
										++calls === 1
											? Effect.die("synthetic defect")
											: Effect.void,
									),
								}),
							),
						),
					),
				),
			);
		},
	);
	it.effect(
		"retains exact typed failure identity and private cause while allowing a stop retry",
		() => {
			const cause = Object.assign(new Error("token=runtime-private"), {
				code: "EIO",
			});
			const failure = new AgentRuntimeFailed(cause);
			return Effect.gen(function* () {
				const service = yield* AgentsRuntime;
				const result = yield* service.control("start").pipe(Effect.either);
				expect(
					result._tag === "Left" &&
						Cause.originalError(result.left) === failure,
				).toBe(true);
				expect(failure.originalCause === cause).toBe(true);
				expect(JSON.stringify(failure)).not.toContain("runtime-private");
				yield* service.control("stop");
				expect((yield* service.read()).status).toBe("stopped");
			}).pipe(
				Effect.provide(
					AgentsRuntime.Default.pipe(
						Layer.provide(
							Layer.succeed(
								AgentRuntimePort,
								port({ start: Effect.fail(failure) }),
							),
						),
					),
				),
			);
		},
	);

	for (const action of ["start", "restart", "stop"] as const)
		it.effect(
			`${action} cancels its backend at the exact timeout and reaches Error`,
			() =>
				Effect.gen(function* () {
					const entered = yield* Deferred.make<void>();
					let cancelled = false;
					const waiting = Deferred.succeed(entered, undefined).pipe(
						Effect.zipRight(Effect.never),
						Effect.ensuring(
							Effect.sync(() => {
								cancelled = true;
							}),
						),
					);
					const backend = port({
						initial:
							action === "start" ? stopped : { ...stopped, status: "ready" },
						[action]: waiting,
					});
					yield* Effect.gen(function* () {
						const service = yield* AgentsRuntime;
						const events: RuntimeState[] = [];
						service.subscribe((s) => events.push(s));
						const fiber = yield* service
							.control(action)
							.pipe(Effect.either, Effect.fork);
						yield* Deferred.await(entered);
						yield* TestClock.adjust(
							action === "stop" ? "4999 millis" : "9999 millis",
						);
						expect((yield* service.read()).status).toBe(
							action === "stop" ? "stopping" : "starting",
						);
						yield* TestClock.adjust("1 millis");
						const result = yield* Fiber.join(fiber);
						expect(result._tag === "Left" && result.left.code).toBe(
							"AGENT.RUNTIME.TIMEOUT",
						);
						expect(cancelled).toBe(true);
						expect((yield* service.read()).status).toBe("error");
						expect(events.at(-1)?.code).toBe("AGENT.RUNTIME.TIMEOUT");
					}).pipe(
						Effect.provide(
							AgentsRuntime.Default.pipe(
								Layer.provide(Layer.succeed(AgentRuntimePort, backend)),
							),
						),
					);
				}),
		);
});
