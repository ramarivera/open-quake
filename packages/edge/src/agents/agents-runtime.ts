import { Effect, Exit, Ref } from "effect";
import type { RuntimeState } from "./agents-contracts.js";
import {
	type AgentError,
	AgentRuntimeBusy,
	AgentRuntimeFailed,
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
			const control = Effect.fn("AgentsRuntime.control")(
				(
					action: "start" | "stop" | "restart",
				): Effect.Effect<void, AgentError> =>
					Effect.uninterruptibleMask((restore) =>
						Effect.gen(function* () {
							if (!port.available) return yield* new AgentRuntimeUnavailable();
							if (yield* Ref.getAndSet(busy, true))
								return yield* new AgentRuntimeBusy();
							let transitionStarted = false;
							return yield* Effect.gen(function* () {
								const current = yield* read();
								if (
									(action === "start" && current.status === "ready") ||
									(action === "stop" && current.status === "stopped")
								)
									return;
								if (
									current.status === "starting" ||
									current.status === "stopping" ||
									(action === "restart" && current.status === "stopped")
								)
									return yield* new AgentRuntimeBusy();
								transitionStarted = true;
								yield* publish({
									available: true,
									status: action === "stop" ? "stopping" : "starting",
									code: "",
									operation: action,
								});
								const outcome = yield* restore(
									port[action].pipe(
										Effect.timeoutFail({
											duration: action === "stop" ? "5 seconds" : "10 seconds",
											onTimeout: () => new AgentRuntimeTimeout(),
										}),
									),
								).pipe(Effect.either);
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
							}).pipe(
								// A cancelled/defective adapter cannot leave an unconfirmed transition
								// looking active forever. Keep terminal states confirmed by its cleanup.
								Effect.onExit((exit) =>
									Effect.suspend(() =>
										transitionStarted &&
										Exit.isFailure(exit) &&
										(state.status === "starting" || state.status === "stopping")
											? publish({
													available: true,
													status: "error",
													code: new AgentRuntimeFailed(exit.cause).code,
													operation: action,
												})
											: Effect.void,
									),
								),
								Effect.ensuring(Ref.set(busy, false)),
							);
						}),
					),
			);
			return {
				read,
				subscribe: (listener: (state: RuntimeState) => void): (() => void) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				control,
			};
		}),
	},
) {}
