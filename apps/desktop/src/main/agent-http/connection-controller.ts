import { Cause, Effect, Either, Exit, Schema } from "effect";
import {
	type RuntimeConnection,
	RuntimeHealth,
} from "../../../../../packages/edge/src/agent-http/runtime-contracts.js";
import {
	RuntimeCapabilityUnsupported,
	RuntimeConnectionInvalid,
	type RuntimeError,
} from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import {
	AgentConnectionCommand,
	AgentConnectionDiscovery,
	type AgentConnectionReply,
	type AgentConnectionView,
} from "../../shared/agent-connections";
import {
	type AgentsAuthority,
	agentRequestAllowed,
} from "../agents/controller";
import type { AgentConnections } from "./connections";

export interface ConnectionOperations {
	readonly health: (
		connection: RuntimeConnection,
	) => Effect.Effect<RuntimeHealth, RuntimeError>;
	readonly discover?: (
		id: string,
	) => Effect.Effect<AgentConnectionDiscovery, RuntimeError>;
}
const rejected = (code: string, message: string): AgentConnectionReply => ({
	_tag: "rejected",
	code,
	message,
});
const closed = (): AgentConnectionReply =>
	rejected(
		"AGENT.HTTP.IPC.DISPOSED",
		"Runtime connection management is closed",
	);
const stale = (): AgentConnectionReply =>
	rejected("AGENT.HTTP.IPC.STALE", "The connection changed; test it again");
/** This is the same authority/decoding/dispatch boundary consumed by production IPC. */
export function createAgentConnectionsController(options: {
	readonly repository: AgentConnections;
	readonly managementId: () => number | undefined;
	readonly renderer: string;
	readonly operations: ConnectionOperations;
}) {
	let disposed = false;
	let generation = 0;
	const pending = new Map<string, AbortController>();
	const requests = new Set<AbortController>();
	const invalidate = (): void => {
		generation++;
		for (const controller of pending.values()) controller.abort();
		pending.clear();
	};
	const off = options.repository.subscribe(invalidate);
	const request = async (
		source: AgentsAuthority,
		input: unknown,
	): Promise<AgentConnectionReply> => {
		if (disposed) return closed();
		if (!agentRequestAllowed(source, options.managementId(), options.renderer))
			return rejected(
				"AGENT.HTTP.IPC.UNAUTHORIZED",
				"Unauthorized runtime connection request",
			);
		const decoded = Schema.decodeUnknownEither(AgentConnectionCommand, {
			onExcessProperty: "error",
		})(input);
		if (Either.isLeft(decoded)) {
			const error = new RuntimeConnectionInvalid();
			return rejected(error.code, error.message);
		}
		const command = decoded.right;
		if (
			command.type === "save" ||
			command.type === "select" ||
			command.type === "remove"
		)
			invalidate();
		const controller = new AbortController();
		requests.add(controller);
		const key =
			command.type === "test" || command.type === "discover"
				? `${command.type}:${command.id}`
				: undefined;
		if (key) {
			pending.get(key)?.abort();
			pending.set(key, controller);
		}
		const started = generation;
		const work: Effect.Effect<AgentConnectionReply, RuntimeError> = Effect.gen(
			function* () {
				let view: AgentConnectionView;
				switch (command.type) {
					case "list":
						view = yield* options.repository.view();
						break;
					case "save":
						view = yield* options.repository.save(command);
						break;
					case "remove":
						view = yield* options.repository.remove(command.id);
						break;
					case "select":
						view = yield* options.repository.select(
							command.id,
							command.agentId,
						);
						break;
					case "test": {
						const connection = yield* options.repository.get(command.id);
						const health = yield* options.operations.health(connection).pipe(
							Effect.flatMap((value) =>
								Schema.decodeUnknown(RuntimeHealth, {
									onExcessProperty: "error",
								})(value).pipe(
									Effect.mapError(
										(cause) => new RuntimeConnectionInvalid(cause),
									),
								),
							),
						);
						if (started !== generation || controller.signal.aborted)
							return stale();
						return {
							_tag: "success",
							view: yield* options.repository.view(),
							health,
						};
					}
					case "discover": {
						yield* options.repository.get(command.id);
						if (!options.operations.discover)
							return yield* new RuntimeCapabilityUnsupported();
						const discovery = yield* options.operations
							.discover(command.id)
							.pipe(
								Effect.flatMap((value) =>
									Schema.decodeUnknown(AgentConnectionDiscovery, {
										onExcessProperty: "error",
									})(value).pipe(
										Effect.mapError(
											(cause) => new RuntimeConnectionInvalid(cause),
										),
									),
								),
							);
						if (
							(discovery.capabilities.listAgents !== "supported" &&
								discovery.agents.length > 0) ||
							(discovery.capabilities.models !== "supported" &&
								(discovery.models?.length ?? 0) > 0)
						)
							return yield* new RuntimeConnectionInvalid();
						if (started !== generation || controller.signal.aborted)
							return stale();
						return {
							_tag: "success",
							view: yield* options.repository.view(),
							discovery,
						};
					}
				}
				return { _tag: "success", view };
			},
		);
		try {
			const result = await Effect.runPromiseExit(work, {
				signal: controller.signal,
			});
			if (disposed) return closed();
			if (
				!agentRequestAllowed(source, options.managementId(), options.renderer)
			)
				return rejected(
					"AGENT.HTTP.IPC.UNAUTHORIZED",
					"Unauthorized runtime connection request",
				);
			if (controller.signal.aborted || (key && started !== generation))
				return stale();
			if (Exit.isSuccess(result)) return result.value;
			const failure = Cause.failureOption(result.cause);
			return failure._tag === "Some"
				? rejected(failure.value.code, failure.value.message)
				: rejected("AGENT.HTTP.REQUEST.FAILED", "The runtime request failed");
		} finally {
			requests.delete(controller);
			if (key && pending.get(key) === controller) pending.delete(key);
		}
	};
	return {
		request,
		dispose: (): void => {
			if (disposed) return;
			disposed = true;
			off();
			invalidate();
			for (const controller of requests) controller.abort();
			requests.clear();
		},
	};
}
