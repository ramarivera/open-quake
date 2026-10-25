import { Effect, Exit, Layer, Scope } from "effect";
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
import { makeDesktopRuntime } from "../diagnostics/runtime";
import {
	type AgentConnectionsRegistration,
	registerAgentConnections,
} from "./connection-registration";
import { registerAgentConversations } from "./conversation-registration";
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

/** The application owns one registry, credential resolver and conversation service.
 * Construction reads local settings only. All HTTP starts with an explicit user action.
 */
export async function registerAgentHttp(options: AgentHttpOptions) {
	const background = makeDesktopRuntime(
		Layer.empty,
		options.diagnostics,
		"agent.connection",
	);
	const scope = background.runSync(Scope.make());
	let connections: AgentConnectionsRegistration | undefined;
	let conversations: ReturnType<typeof registerAgentConversations> | undefined;
	let registry: RuntimeRegistry | undefined;
	const credentials: RuntimeCredentialResolver = {
		resolve: (reference) =>
			Effect.suspend(() =>
				connections
					? connections.repository.resolveCredential(reference)
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
		if (!connections) return yield* new RuntimeUnavailable();
		const connection = yield* connections.repository.get(id);
		return { connection, adapter: providers[connection.kind] };
	});
	const resources = createRuntimeResources(resolve);
	try {
		connections = await registerAgentConnections({
			...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
			management: options.management,
			renderer: options.renderer,
			...(options.root ? { root: options.root } : {}),
			operations: {
				health: (connection) =>
					Effect.gen(function* () {
						if (!registry) return yield* new RuntimeUnavailable();
						const result = yield* registry.connect(connection.id);
						return result.health ?? (yield* new RuntimeUnavailable());
					}),
				discover: resources.discover,
			},
		});
		const repository = connections.repository;
		registry = await background.runPromise(
			createRuntimeRegistry({ resolve }).pipe(
				Effect.provideService(Scope.Scope, scope),
			),
		);
		const selectedRegistry = registry;
		conversations = registerAgentConversations({
			...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
			management: options.management,
			renderer: options.renderer,
			resolve: registry.resolve,
		});
		const conversationRegistration = conversations;
		const service = await conversations.runtime.runPromise(ConversationService);
		let generation = 0;
		let closed = false;
		let disposal: Promise<void> | undefined;
		let transition = Promise.resolve();
		const selected = () =>
			Effect.tryPromise({
				try: () => transition,
				catch: (cause) => new RuntimeRequestFailed(cause),
			}).pipe(Effect.zipRight(repository.selected()));
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
		const offRegistry = registry.subscribe((snapshot) => {
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
			backend: createAgentRuntimeAdapter(registry),
			// Setup checks saved configuration, independent of a server being online.
			configured: () =>
				background.runPromise(
					repository
						.view()
						.pipe(Effect.map((view) => view.connections.length > 0)),
				),
			drafting: createAgentDraftAdapter({
				resolve: registry.resolve,
				selected: () =>
					selected().pipe(
						Effect.map((selected) =>
							selected
								? {
										connectionId: selected.connectionId,
										...(selected.agentId === undefined
											? {}
											: { agentId: selected.agentId }),
									}
								: undefined,
						),
					),
			}),
			createVoiceAdapter: (
				fallback: Parameters<typeof createAgentHttpVoiceAdapter>[1],
				fallbackTranscript?: Parameters<typeof createAgentHttpVoiceAdapter>[2],
			) =>
				createAgentHttpVoiceAdapter(
					{
						selected,
						stream: service.stream,
						cancel: service.cancel,
						generation: () => generation,
					},
					fallback,
					fallbackTranscript,
				),
			decorateVoiceRuntime: (
				fallback: Parameters<typeof agentHttpVoiceLayer>[1],
			) =>
				agentHttpVoiceLayer(
					{
						selected,
						stream: service.stream,
						cancel: service.cancel,
						generation: () => generation,
					},
					fallback,
				),
			dispose: (): Promise<void> => {
				if (disposal) return disposal;
				closed = true;
				generation++;
				offConnections();
				offRegistry();
				disposal = (async () => {
					await background.runPromise(service.shutdown());
					await conversationRegistration.dispose();
					await Promise.allSettled([...pending]);
					await connections?.dispose();
					await background.runPromise(Scope.close(scope, Exit.void));
					await background.dispose();
				})();
				return disposal;
			},
		};
	} catch (cause) {
		await conversations?.dispose();
		await connections?.dispose();
		await background.runPromise(Scope.close(scope, Exit.void));
		await background.dispose();
		throw cause;
	}
}
