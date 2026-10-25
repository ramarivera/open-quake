import { Effect } from "effect";
import type {
	RuntimeAgent,
	RuntimeCapabilities,
	RuntimeModel,
	RuntimeResource,
	RuntimeSession,
} from "../../../../../packages/edge/src/agent-http/runtime-contracts.js";
import {
	RuntimeCapabilityUnsupported,
	type RuntimeError,
	RuntimeTimeout,
} from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import type { RuntimeResolver } from "./runtime-registry.js";

export interface RuntimeDiscovery {
	readonly capabilities: RuntimeCapabilities;
	/** Empty when listAgents isn't supported. Capability status retains the distinction. */
	readonly agents: readonly RuntimeAgent[];
	readonly models?: readonly RuntimeModel[];
}
export interface RuntimeResources {
	readonly discover: (
		connectionId: string,
	) => Effect.Effect<RuntimeDiscovery, RuntimeError>;
	readonly capabilities: (
		connectionId: string,
	) => Effect.Effect<RuntimeCapabilities, RuntimeError>;
	readonly listAgents: (
		connectionId: string,
	) => Effect.Effect<readonly RuntimeAgent[], RuntimeError>;
	readonly listModels: (
		connectionId: string,
	) => Effect.Effect<readonly RuntimeModel[], RuntimeError>;
	readonly listSessions: (
		connectionId: string,
	) => Effect.Effect<readonly RuntimeSession[], RuntimeError>;
	readonly listResources: (
		connectionId: string,
		agentId: string,
	) => Effect.Effect<readonly RuntimeResource[], RuntimeError>;
}
const bounded = <A>(work: Effect.Effect<A, RuntimeError>) =>
	work.pipe(
		Effect.timeoutFail({
			duration: "10 seconds",
			onTimeout: () => new RuntimeTimeout(),
		}),
	);

/** Read-only provider discovery. Local workspaces and model configuration stay local.
 * The shared provider contract has no read-content, write or delete operation.
 */
export function createRuntimeResources(
	resolve: RuntimeResolver,
): RuntimeResources {
	return {
		capabilities: Effect.fn("AgentHttp.resources.capabilities")((id) =>
			bounded(
				Effect.gen(function* () {
					const { connection, adapter } = yield* resolve(id);
					return yield* adapter.capabilities(connection);
				}),
			),
		),
		discover: Effect.fn("AgentHttp.resources.discover")((id) =>
			bounded(
				Effect.gen(function* () {
					const { connection, adapter } = yield* resolve(id);
					const capabilities = yield* adapter.capabilities(connection);
					const agents =
						capabilities.listAgents === "supported"
							? yield* adapter.listAgents(connection)
							: [];
					const models =
						capabilities.models === "supported" && adapter.listModels
							? yield* adapter.listModels(connection)
							: undefined;
					return { capabilities, agents, ...(models ? { models } : {}) };
				}),
			),
		),
		listAgents: Effect.fn("AgentHttp.resources.listAgents")((id) =>
			bounded(
				Effect.gen(function* () {
					const { connection, adapter } = yield* resolve(id);
					const capabilities = yield* adapter.capabilities(connection);
					if (capabilities.listAgents !== "supported")
						return yield* new RuntimeCapabilityUnsupported();
					return yield* adapter.listAgents(connection);
				}),
			),
		),
		listModels: Effect.fn("AgentHttp.resources.listModels")((id) =>
			bounded(
				Effect.gen(function* () {
					const { connection, adapter } = yield* resolve(id);
					const capabilities = yield* adapter.capabilities(connection);
					if (capabilities.models !== "supported" || !adapter.listModels)
						return yield* new RuntimeCapabilityUnsupported();
					return yield* adapter.listModels(connection);
				}),
			),
		),
		listSessions: Effect.fn("AgentHttp.resources.listSessions")((id) =>
			bounded(
				Effect.gen(function* () {
					const { connection, adapter } = yield* resolve(id);
					const capabilities = yield* adapter.capabilities(connection);
					if (capabilities.sessions !== "supported" || !adapter.listSessions)
						return yield* new RuntimeCapabilityUnsupported();
					return yield* adapter.listSessions(connection);
				}),
			),
		),
		listResources: Effect.fn("AgentHttp.resources.listResources")(
			(id, agentId) =>
				bounded(
					Effect.gen(function* () {
						const { connection, adapter } = yield* resolve(id);
						const capabilities = yield* adapter.capabilities(connection);
						if (
							capabilities.resources !== "supported" ||
							!adapter.listResources
						)
							return yield* new RuntimeCapabilityUnsupported();
						return yield* adapter.listResources(connection, agentId);
					}),
				),
		),
	};
}
