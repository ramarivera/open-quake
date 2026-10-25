import {
	Context,
	type Effect,
	type Redacted,
	type Scope,
	type Stream,
} from "effect";
import type {
	RuntimeAgent,
	RuntimeCapabilities,
	RuntimeConnection,
	RuntimeConversationEvent,
	RuntimeConversationRequest,
	RuntimeHealth,
	RuntimeKind,
	RuntimeModel,
	RuntimeResource,
	RuntimeSession,
} from "./runtime-contracts.js";
import type { RuntimeError } from "./runtime-errors.js";

/** No lifecycle operations. Capabilities are verified per connection/protocol. */
export interface RuntimeProviderAdapter {
	readonly kind: RuntimeKind;
	readonly health: (
		connection: RuntimeConnection,
	) => Effect.Effect<RuntimeHealth, RuntimeError>;
	readonly capabilities: (
		connection: RuntimeConnection,
	) => Effect.Effect<RuntimeCapabilities, RuntimeError>;
	/** Must fail RuntimeCapabilityUnsupported when no real agent catalog exists. */
	readonly listAgents: (
		connection: RuntimeConnection,
	) => Effect.Effect<readonly RuntimeAgent[], RuntimeError>;
	/** Interrupting consumption must abort network work. */
	readonly streamConversation: (
		connection: RuntimeConnection,
		request: RuntimeConversationRequest,
	) => Stream.Stream<RuntimeConversationEvent, RuntimeError>;
	readonly listSessions?: (
		connection: RuntimeConnection,
	) => Effect.Effect<readonly RuntimeSession[], RuntimeError>;
	readonly listResources?: (
		connection: RuntimeConnection,
		agentId: string,
	) => Effect.Effect<readonly RuntimeResource[], RuntimeError>;
	readonly listModels?: (
		connection: RuntimeConnection,
	) => Effect.Effect<readonly RuntimeModel[], RuntimeError>;
}
export class RuntimeProviderPort extends Context.Tag("RuntimeProviderPort")<
	RuntimeProviderPort,
	RuntimeProviderAdapter
>() {}

export interface RuntimeCredentialResolver {
	readonly resolve: (
		reference: string,
	) => Effect.Effect<Redacted.Redacted<string>, RuntimeError>;
}
export class RuntimeCredentialPort extends Context.Tag("RuntimeCredentialPort")<
	RuntimeCredentialPort,
	RuntimeCredentialResolver
>() {}

export interface RuntimeHttpLimits {
	readonly timeoutMs?: number;
	readonly maxResponseBytes?: number;
	readonly maxErrorBytes?: number;
	readonly maxEventBytes?: number;
}
/** path is relative to baseURL; leading / retains the configured base subpath. */
export interface RuntimeHttpRequest extends RuntimeHttpLimits {
	readonly connection: RuntimeConnection;
	readonly path: string;
	readonly method: "GET" | "POST";
	readonly credential?: Redacted.Redacted<string>;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: unknown;
	readonly signal?: AbortSignal;
}
export interface RuntimeHttpResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: Stream.Stream<Uint8Array, RuntimeError>;
}
/** Scope close physically aborts fetch; redirects are never followed. */
export interface RuntimeHttpTransport {
	readonly execute: (
		request: RuntimeHttpRequest,
	) => Effect.Effect<RuntimeHttpResponse, RuntimeError, Scope.Scope>;
}
export class RuntimeHttpPort extends Context.Tag("RuntimeHttpPort")<
	RuntimeHttpPort,
	RuntimeHttpTransport
>() {}
