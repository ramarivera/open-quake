import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, TestClock } from "effect";
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
		"publishes ready/error states, rejects conflicting controls and unsubscribes on scope close",
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
					expect(duplicate._tag === "Left" && duplicate.left.code).toBe(
						"AGENT.RUNTIME.BUSY",
					);
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
