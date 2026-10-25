import { Deferred, Effect, Fiber, type Redacted, type Scope } from "effect";
import type {
	RuntimeCapabilities,
	RuntimeConnection,
	RuntimeHealth,
} from "../../../../../packages/edge/src/agent-http/runtime-contracts.js";
import {
	RuntimeConnectionInvalid,
	type RuntimeError,
	RuntimeTimeout,
	RuntimeUnavailable,
} from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import type { RuntimeProviderAdapter } from "../../../../../packages/edge/src/agent-http/runtime-ports.js";

/** Main-process only. Provider factories bind credential resolution themselves. */
export interface ResolvedRuntime {
	readonly connection: RuntimeConnection;
	readonly credential?: Redacted.Redacted<string>;
	readonly adapter: RuntimeProviderAdapter;
}
export type RuntimeResolver = (
	connectionId: string,
) => Effect.Effect<ResolvedRuntime, RuntimeError>;
export interface RuntimeRegistrySnapshot {
	readonly generation: number;
	readonly status:
		| "disconnected"
		| "connecting"
		| "connected"
		| "authenticationRequired"
		| "unavailable"
		| "error";
	readonly connectionId?: string;
	readonly health?: RuntimeHealth;
	readonly capabilities?: RuntimeCapabilities;
	readonly code?: string;
}
export interface RuntimeRegistry {
	readonly resolve: RuntimeResolver;
	readonly read: () => Effect.Effect<RuntimeRegistrySnapshot>;
	readonly subscribe: (
		listener: (snapshot: RuntimeRegistrySnapshot) => void,
	) => () => void;
	readonly connect: (
		connectionId: string,
	) => Effect.Effect<RuntimeRegistrySnapshot, RuntimeError>;
	readonly disconnect: () => Effect.Effect<void>;
	readonly refresh: () => Effect.Effect<RuntimeRegistrySnapshot, RuntimeError>;
}
export interface RuntimeRegistryOptions {
	readonly resolve: RuntimeResolver;
	readonly pollIntervalMs?: number;
	readonly healthTimeoutMs?: number;
}
const bounded = (
	value: number | undefined,
	fallback: number,
	min: number,
	max: number,
) =>
	value !== undefined && Number.isFinite(value)
		? Math.max(min, Math.min(max, value))
		: fallback;

/** Offline on creation. Closing its scope disconnects HTTP work, never the server. */
export const createRuntimeRegistry = Effect.fn(
	"AgentHttp.createRuntimeRegistry",
)(function* (
	options: RuntimeRegistryOptions,
): Effect.fn.Return<RuntimeRegistry, never, Scope.Scope> {
	const scope = yield* Effect.scope;
	const lock = yield* Effect.makeSemaphore(1);
	const interval = bounded(options.pollIntervalMs, 15000, 1000, 60000);
	const timeout = bounded(options.healthTimeoutMs, 10000, 100, 30000);
	let generation = 0;
	let disposed = false;
	let state: RuntimeRegistrySnapshot = { generation, status: "disconnected" };
	let worker: Fiber.RuntimeFiber<void, never> | undefined;
	const listeners = new Set<(snapshot: RuntimeRegistrySnapshot) => void>();
	const publish = (next: RuntimeRegistrySnapshot) =>
		Effect.sync(() => {
			if (next.generation !== generation || disposed) return;
			state = next;
			for (const listener of listeners) listener(next);
		});
	const resolve: RuntimeResolver = Effect.fn("AgentHttp.resolveRuntime")(
		function* (id) {
			if (disposed) return yield* new RuntimeUnavailable();
			const resolved = yield* options.resolve(id);
			if (
				resolved.connection.id !== id ||
				resolved.adapter.kind !== resolved.connection.kind
			)
				return yield* new RuntimeConnectionInvalid();
			return resolved;
		},
	);
	const invalidate = Effect.fn("AgentHttp.invalidateConnection")(function* () {
		generation++;
		const previous = worker;
		worker = undefined;
		if (previous) yield* Fiber.interrupt(previous);
	});
	const disconnect = Effect.fn("AgentHttp.disconnect")(() =>
		lock.withPermits(1)(
			Effect.gen(function* () {
				yield* invalidate();
				yield* publish({ generation, status: "disconnected" });
			}),
		),
	);
	yield* Effect.addFinalizer(() =>
		Effect.gen(function* () {
			disposed = true;
			yield* invalidate();
			state = { generation, status: "disconnected" };
			listeners.clear();
		}),
	);
	const connect = Effect.fn("AgentHttp.connect")(
		(
			connectionId: string,
		): Effect.Effect<RuntimeRegistrySnapshot, RuntimeError> =>
			Effect.uninterruptibleMask((restore) =>
				Effect.gen(function* () {
					const first = yield* Deferred.make<
						RuntimeRegistrySnapshot,
						RuntimeError
					>();
					const token = yield* lock.withPermits(1)(
						Effect.gen(function* () {
							if (disposed) return yield* new RuntimeUnavailable();
							yield* invalidate();
							const current = generation;
							yield* publish({
								generation: current,
								connectionId,
								status: "connecting",
							});
							const probe = Effect.gen(function* () {
								// Re-resolve each poll so credential edits/removal don't retain stale secrets.
								const { connection, adapter } = yield* resolve(connectionId);
								const health = yield* adapter.health(connection);
								const capabilities =
									health.status === "ready"
										? yield* adapter.capabilities(connection)
										: undefined;
								const next: RuntimeRegistrySnapshot = {
									generation: current,
									connectionId,
									health,
									status:
										health.status === "ready" ? "connected" : health.status,
									...(capabilities ? { capabilities } : {}),
								};
								yield* publish(next);
								return next;
							}).pipe(
								Effect.timeoutFail({
									duration: timeout,
									onTimeout: () => new RuntimeTimeout(),
								}),
							);
							const runProbe = probe.pipe(
								Effect.either,
								Effect.tap((result) => {
									if (result._tag === "Right") return Effect.void;
									return publish({
										generation: current,
										connectionId,
										status:
											result.left._tag === "RuntimeAuthenticationFailed"
												? "authenticationRequired"
												: "error",
										code: result.left.code,
									});
								}),
							);
							worker = yield* Effect.gen(function* () {
								let result = yield* runProbe;
								yield* result._tag === "Right"
									? Deferred.succeed(first, result.right)
									: Deferred.fail(first, result.left);
								while (current === generation && !disposed) {
									if (
										(result._tag === "Left" &&
											result.left._tag === "RuntimeAuthenticationFailed") ||
										(result._tag === "Right" &&
											result.right.status === "authenticationRequired")
									)
										return;
									yield* Effect.sleep(interval);
									result = yield* runProbe;
								}
							}).pipe(
								Effect.ensuring(Deferred.fail(first, new RuntimeUnavailable())),
								Effect.interruptible,
								Effect.forkIn(scope),
							);
							return current;
						}),
					);
					return yield* restore(Deferred.await(first)).pipe(
						Effect.onInterrupt(() =>
							lock.withPermits(1)(
								Effect.gen(function* () {
									if (token !== generation) return;
									yield* invalidate();
									yield* publish({ generation, status: "disconnected" });
								}),
							),
						),
					);
				}),
			),
	);
	return {
		resolve,
		read: Effect.fn("AgentHttp.readConnection")(() => Effect.sync(() => state)),
		subscribe: (listener) => {
			if (disposed) return () => {};
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		connect,
		disconnect,
		refresh: Effect.fn("AgentHttp.refreshConnection")(() =>
			Effect.suspend(() =>
				state.connectionId
					? connect(state.connectionId)
					: Effect.fail(new RuntimeUnavailable()),
			),
		),
	};
});
