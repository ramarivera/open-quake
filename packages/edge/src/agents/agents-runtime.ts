import { Effect, Ref } from "effect";
import type { RuntimeState } from "./agents-contracts.js";
import {
	type AgentError,
	AgentRuntimeBusy,
	AgentRuntimeTimeout,
	AgentRuntimeUnavailable,
} from "./agents-errors.js";
import { AgentRuntimePort } from "./agents-ports.js";
export class AgentsRuntime extends Effect.Service<AgentsRuntime>()(
	"AgentsRuntime",
	{
		accessors: true,
		scoped: Effect.gen(function* () {
			const port = yield* AgentRuntimePort;
			let state: RuntimeState = { ...port.initial, available: port.available };
			const listeners = new Set<(state: RuntimeState) => void>();
			const busy = yield* Ref.make(false);
			const publish = (next: RuntimeState): Effect.Effect<void> =>
				Effect.sync(() => {
					state = next;
					for (const listener of listeners) listener(next);
				});
			// Subscription callbacks enter through a scoped dispatcher owned by the layer.
			const queue = yield* Effect.makeSemaphore(1);
			yield* Effect.acquireRelease(
				Effect.sync(() =>
					port.subscribe((next) => {
						state = { ...next, available: port.available };
						for (const listener of listeners) listener(state);
					}),
				),
				(off) => Effect.sync(off),
			);
			const read = Effect.fn("AgentsRuntime.read")(
				(): Effect.Effect<RuntimeState> => Effect.sync(() => state),
			);
			return {
				read,
				subscribe: (listener: (state: RuntimeState) => void): (() => void) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				control: Effect.fn("AgentsRuntime.control")(function* (
					action: "start" | "stop" | "restart",
				): Effect.fn.Return<void, AgentError> {
					if (!port.available) return yield* new AgentRuntimeUnavailable();
					if (yield* Ref.getAndSet(busy, true))
						return yield* new AgentRuntimeBusy();
					return yield* queue
						.withPermits(1)(
							Effect.gen(function* () {
								const current = yield* read();
								if (
									(action === "start" &&
										(current.status === "ready" ||
											current.status === "starting")) ||
									(action !== "start" && current.status !== "ready")
								)
									return yield* new AgentRuntimeBusy();
								yield* publish({
									available: true,
									status: action === "stop" ? "stopping" : "starting",
									code: "",
									operation: action,
								});
								const outcome = yield* port[action].pipe(
									Effect.timeoutFail({
										duration: action === "stop" ? "5 seconds" : "10 seconds",
										onTimeout: () => new AgentRuntimeTimeout(),
									}),
									Effect.either,
								);
								if (outcome._tag === "Left") {
									yield* publish({
										available: true,
										status: "error",
										code: outcome.left.code,
										operation: action,
									});
									return yield* outcome.left;
								}
								yield* publish({
									available: true,
									status: action === "stop" ? "stopped" : "ready",
									code: "",
									operation: action,
								});
							}),
						)
						.pipe(Effect.ensuring(Ref.set(busy, false)));
				}),
			};
		}),
	},
) {}
