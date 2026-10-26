import { Context, Effect, Layer, Stream } from "effect";
import type { BrowserWindow } from "electron";
import { ConversationService } from "../../../../../packages/edge/src/agent-http/conversation-service.js";
import { makeHermesRuntimeAdapter } from "../../../../../packages/edge/src/agent-http/hermes/hermes-adapter.js";
import { makeOpenClawAdapter } from "../../../../../packages/edge/src/agent-http/openclaw/index.js";
import {
	RuntimeRequestFailed,
	RuntimeUnavailable,
} from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import type { RuntimeCredentialResolver } from "../../../../../packages/edge/src/agent-http/runtime-ports.js";
import { makeRuntimeHttpTransport } from "../../../../../packages/edge/src/agent-http/transport.js";
import type { VoiceSurfaceEvent } from "../../shared/voice-surface";
import type { DesktopDiagnostics } from "../diagnostics";
import { prepareDesktopModule } from "../diagnostics/module";
import {
	acquireAgentConnections,
	activateAgentConnections,
} from "./connection-registration";
import type { AgentConnections } from "./connections";
import { prepareAgentConversations } from "./conversation-registration";
import {
	createAgentDraftAdapter,
	createAgentRuntimeAdapter,
} from "./management-adapter";
import { createRuntimeResources } from "./resources";
import {
	createRuntimeRegistry,
	type RuntimeRegistry,
	type RuntimeResolver,
} from "./runtime-registry";
import {
	agentHttpVoiceLayer,
	createAgentHttpVoiceAdapter,
} from "./voice-adapter";

export interface AgentHttpOptions {
	readonly diagnostics?: DesktopDiagnostics;
	readonly management: () => BrowserWindow | undefined;
	readonly renderer: string;
	readonly root?: string;
	readonly invalidated: () => Promise<void>;
	readonly publish: (event: VoiceSurfaceEvent) => Promise<void>;
}

class AgentHttpState extends Context.Tag("DesktopAgentHttpState")<
	AgentHttpState,
	{
		readonly repository: AgentConnections | undefined;
		readonly registry: RuntimeRegistry;
		readonly service: typeof ConversationService.Service;
	}
>() {}

/** Local repository, scoped registry and conversations share the application's graph. */
export function prepareAgentHttp(options: AgentHttpOptions) {
	let repository: AgentConnections | undefined;
	let registry: RuntimeRegistry | undefined;
	let service: typeof ConversationService.Service | undefined;
	const credentials: RuntimeCredentialResolver = {
		resolve: (reference) =>
			Effect.suspend(() =>
				repository
					? repository.resolveCredential(reference)
					: Effect.fail(new RuntimeUnavailable()),
			),
	};
	const http = makeRuntimeHttpTransport();
	const providers = {
		openclaw: makeOpenClawAdapter({ http, credentials }),
		hermes: makeHermesRuntimeAdapter({ transport: http, credentials }),
	};
	const resolve: RuntimeResolver = Effect.fn(
		"AgentHttp.resolveProductionRuntime",
	)(function* (id) {
		if (!repository) return yield* new RuntimeUnavailable();
		const connection = yield* repository.get(id);
		return { connection, adapter: providers[connection.kind] };
	});
	const resources = createRuntimeResources(resolve);
	const connectionOptions = {
		...options,
		operations: {
			health: (
				connection: import("../../../../../packages/edge/src/agent-http/runtime-contracts").RuntimeConnection,
			) =>
				Effect.suspend(() =>
					registry
						? registry
								.connect(connection.id)
								.pipe(
									Effect.flatMap((result) =>
										result.health
											? Effect.succeed(result.health)
											: Effect.fail(new RuntimeUnavailable()),
									),
								)
						: Effect.fail(new RuntimeUnavailable()),
				),
			discover: resources.discover,
		},
	};
	class ConnectionsState extends Context.Tag("DesktopAgentConnectionsState")<
		ConnectionsState,
		AgentConnections | undefined
	>() {}
	const connectionsLayer = Layer.scoped(
		ConnectionsState,
		Effect.gen(function* () {
			const acquisition = acquireAgentConnections(connectionOptions);
			const result = yield* (
				options.diagnostics
					? options.diagnostics.instrument(acquisition, "agent.connection")
					: acquisition
			).pipe(Effect.either);
			if (result._tag === "Left") {
				yield* Effect.logWarning("HTTP runtime setup failed", result.left);
				return undefined;
			}
			repository = result.right;
			const acquired = repository;
			yield* Effect.addFinalizer(() => Effect.sync(acquired.dispose));
			return acquired;
		}),
	);
	class RegistryState extends Context.Tag("DesktopAgentRegistryState")<
		RegistryState,
		RuntimeRegistry
	>() {}
	const registryLayer = Layer.scoped(
		RegistryState,
		Effect.gen(function* () {
			yield* ConnectionsState;
			registry = yield* createRuntimeRegistry({ resolve });
			return registry;
		}),
	).pipe(Layer.provideMerge(connectionsLayer));
	const conversationModule = prepareAgentConversations({
		...options,
		resolve: (id) =>
			Effect.suspend(() =>
				registry ? registry.resolve(id) : Effect.fail(new RuntimeUnavailable()),
			),
	});
	const layer = Layer.effect(
		AgentHttpState,
		Effect.gen(function* () {
			const selectedRepository = yield* ConnectionsState;
			const selectedRegistry = yield* RegistryState;
			service = yield* ConversationService;
			return {
				repository: selectedRepository,
				registry: selectedRegistry,
				service,
			};
		}),
	).pipe(
		Layer.provideMerge(
			conversationModule.layer.pipe(Layer.provideMerge(registryLayer)),
		),
	);
	let generation = 0;
	let transition = Promise.resolve();
	const selected = () =>
		Effect.tryPromise({
			try: () => transition,
			catch: (cause) => new RuntimeRequestFailed(cause),
		}).pipe(
			Effect.zipRight(
				Effect.suspend(() =>
					repository ? repository.selected() : Effect.succeed(undefined),
				),
			),
		);
	const voiceOptions = {
		selected,
		stream: (...args: Parameters<typeof ConversationService.Service.stream>) =>
			service ? service.stream(...args) : Stream.fail(new RuntimeUnavailable()),
		cancel: (...args: Parameters<typeof ConversationService.Service.cancel>) =>
			service ? service.cancel(...args) : Effect.void,
		generation: () => generation,
	};
	const backend = createAgentRuntimeAdapter({
		resolve,
		read: () =>
			Effect.suspend(() =>
				registry
					? registry.read()
					: Effect.succeed({ generation: 0, status: "unavailable" as const }),
			),
		subscribe: (listener) =>
			registry ? registry.subscribe(listener) : () => {},
		connect: (id) =>
			Effect.suspend(() =>
				registry ? registry.connect(id) : Effect.fail(new RuntimeUnavailable()),
			),
		disconnect: () =>
			Effect.suspend(() => (registry ? registry.disconnect() : Effect.void)),
		refresh: () =>
			Effect.suspend(() =>
				registry ? registry.refresh() : Effect.fail(new RuntimeUnavailable()),
			),
	});
	const draftAdapter = createAgentDraftAdapter({
		resolve,
		selected: () =>
			selected().pipe(
				Effect.map((value) =>
					value
						? {
								connectionId: value.connectionId,
								...(value.agentId === undefined
									? {}
									: { agentId: value.agentId }),
							}
						: undefined,
				),
			),
	});
	const drafting = {
		...draftAdapter,
		available: () => repository !== undefined,
	};
	const prepared = prepareDesktopModule(
		layer,
		async (background) => {
			const state = await background.runPromise(AgentHttpState);
			if (!state.repository) return undefined;
			const repository = state.repository;
			const selectedRegistry = state.registry;
			const service = state.service;
			const connections = activateAgentConnections(
				repository,
				connectionOptions,
			);
			conversationModule.bind(background);
			const conversationRegistration = conversationModule.start();
			let closed = false;
			let disposal: Promise<void> | undefined;
			const pending = new Set<Promise<void>>();
			const track = (work: Promise<void>): void => {
				const settled = work.catch((cause: unknown) => {
					const error = new RuntimeRequestFailed(cause);
					background.runSync(
						Effect.logWarning("HTTP runtime state update failed", {
							code: error.code,
						}),
					);
				});
				pending.add(settled);
				void settled.finally(() => pending.delete(settled));
			};
			const offConnections = repository.subscribe(() => {
				if (closed) return;
				generation++;
				const cancellation = background.runPromise(
					Effect.all(
						[
							service.cancelOwner("voice"),
							...(options.management()
								? [
										service.cancelOwner(
											`management:${options.management()?.webContents.id}`,
										),
									]
								: []),
							selectedRegistry.disconnect(),
						],
						{ concurrency: 2, discard: true },
					),
				);
				transition = Promise.all([transition, cancellation]).then(
					options.invalidated,
				);
				track(transition);
			});
			const offRegistry = selectedRegistry.subscribe((snapshot) => {
				if (closed) return;
				track(
					options.publish({
						_tag: "AgentStatus",
						state:
							snapshot.status === "connected"
								? "connected"
								: snapshot.status === "connecting"
									? "connecting"
									: "noService",
					}),
				);
			});
			return {
				backend,
				// Setup checks saved configuration, independent of a server being online.
				configured: () =>
					background.runPromise(
						repository
							.view()
							.pipe(Effect.map((view) => view.connections.length > 0)),
					),
				drafting,
				dispose: (): Promise<void> => {
					if (disposal) return disposal;
					closed = true;
					generation++;
					offConnections();
					offRegistry();
					disposal = (async () => {
						await conversationRegistration.dispose();
						await Promise.allSettled([...pending]);
						await connections.dispose();
						await background.runPromise(selectedRegistry.disconnect());
						await background.dispose();
					})();
					return disposal;
				},
			};
		},
		options.diagnostics,
		"agent.connection",
	);
	return {
		...prepared,
		backend,
		drafting,
		createVoiceAdapter: (
			fallback: Parameters<typeof createAgentHttpVoiceAdapter>[1],
			fallbackTranscript?: Parameters<typeof createAgentHttpVoiceAdapter>[2],
		) =>
			createAgentHttpVoiceAdapter(voiceOptions, fallback, fallbackTranscript),
		decorateVoiceRuntime: (
			fallback: Parameters<typeof agentHttpVoiceLayer>[1],
		) => agentHttpVoiceLayer(voiceOptions, fallback),
	};
}

export async function registerAgentHttp(options: AgentHttpOptions) {
	const prepared = prepareAgentHttp(options);
	try {
		const registration = await prepared.standalone();
		if (!registration) throw new RuntimeUnavailable();
		return {
			...registration,
			createVoiceAdapter: prepared.createVoiceAdapter,
			decorateVoiceRuntime: prepared.decorateVoiceRuntime,
		};
	} catch (cause) {
		await prepared.runtime.dispose();
		throw cause;
	}
}
