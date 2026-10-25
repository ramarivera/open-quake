/** Protocol source: openclaw/openclaw@384100f491d78350c4754d5cf7b2482985ccbf76,
 * src/gateway/{models-http,openai-http,openresponses-http,server-http-probes}.ts.
 * /v1/models exposes agent targets, not a backend model inventory. */
import { Effect, Schema, Stream } from "effect";
import {
	type RuntimeAgent,
	type RuntimeCapabilities,
	RuntimeConnection,
	type RuntimeConversationEvent,
	RuntimeConversationRequest,
	type RuntimeHealth,
} from "../runtime-contracts.js";
import {
	RuntimeAuthenticationFailed,
	RuntimeCapabilityUnsupported,
	RuntimeConnectionInvalid,
	type RuntimeError,
	RuntimeProtocolInvalid,
	RuntimeRequestFailed,
} from "../runtime-errors.js";
import type {
	RuntimeCredentialResolver,
	RuntimeHttpRequest,
	RuntimeHttpTransport,
	RuntimeProviderAdapter,
} from "../runtime-ports.js";
import { readJson } from "../transport.js";
import { normalizeOpenClawStream, type OpenClawProtocol } from "./protocol.js";

const Catalog = Schema.Struct({
	object: Schema.Literal("list"),
	data: Schema.Array(
		Schema.Struct({
			id: Schema.NonEmptyString,
			object: Schema.Literal("model"),
			owned_by: Schema.Literal("openclaw"),
		}),
	).pipe(Schema.maxItems(1024)),
});
const Ready = Schema.Struct({ ready: Schema.Boolean });
const unsafeHeader = (value: string): boolean =>
	[...value].some((character) => {
		const code = character.charCodeAt(0);
		return code < 32 || code > 126;
	});
const AgentId = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const protocolPath = (protocol: OpenClawProtocol) =>
	protocol === "responses" ? "/v1/responses" : "/v1/chat/completions";
const statusError = (status: number): RuntimeError =>
	status === 401 || status === 403
		? new RuntimeAuthenticationFailed({ status })
		: new RuntimeRequestFailed({ status });

export interface OpenClawAdapterOptions {
	readonly http: RuntimeHttpTransport;
	readonly credentials?: RuntimeCredentialResolver;
	/** Auto uses read-only GET probes before dispatch; it never retries a POST. */
	readonly protocol?: OpenClawProtocol | "auto";
}

/** Existing gateway only. HTTP has no lifecycle or built-in tool-progress API. */
export function makeOpenClawAdapter(
	options: OpenClawAdapterOptions,
): RuntimeProviderAdapter {
	const authenticated = Effect.fn("OpenClawAdapter.authenticated")(function* (
		connection: RuntimeConnection,
	) {
		if (
			!Schema.is(RuntimeConnection)(connection) ||
			connection.kind !== "openclaw"
		)
			return yield* new RuntimeConnectionInvalid();
		if (connection.credentialRef === undefined) return {};
		if (!options.credentials) return yield* new RuntimeAuthenticationFailed();
		const credential = yield* options.credentials.resolve(
			connection.credentialRef,
		);
		return { credential };
	});
	const probeProtocol = Effect.fn("OpenClawAdapter.probeProtocol")(function* (
		request: Omit<RuntimeHttpRequest, "path" | "method">,
	) {
		const protocols: readonly OpenClawProtocol[] =
			options.protocol && options.protocol !== "auto"
				? [options.protocol]
				: ["responses", "chatCompletions"];
		for (const protocol of protocols) {
			const supported = yield* Effect.scoped(
				Effect.gen(function* () {
					const response = yield* options.http.execute({
						...request,
						path: protocolPath(protocol),
						method: "GET",
					});
					if (response.status === 401 || response.status === 403)
						return yield* statusError(response.status);
					if (response.status === 405) {
						// OpenClaw's POST handlers send Allow: POST before authentication.
						return (
							response.headers.allow
								?.split(",")
								.some((method) => method.trim().toUpperCase() === "POST") ===
							true
						);
					}
					if (response.status >= 500 || response.status === 429)
						return yield* statusError(response.status);
					return false;
				}),
			);
			if (supported) return protocol;
		}
		return yield* new RuntimeCapabilityUnsupported();
	});
	const catalog = Effect.fn("OpenClawAdapter.catalog")(function* (
		request: Omit<RuntimeHttpRequest, "path" | "method">,
	) {
		return yield* Effect.scoped(
			Effect.gen(function* () {
				const response = yield* options.http.execute({
					...request,
					path: "/v1/models",
					method: "GET",
				});
				if (response.status === 404 || response.status === 405)
					return yield* new RuntimeCapabilityUnsupported();
				const payload = yield* readJson(response);
				return yield* Schema.decodeUnknown(Catalog)(payload).pipe(
					Effect.mapError((cause) => new RuntimeProtocolInvalid(cause)),
				);
			}),
		);
	});
	const listAgents: RuntimeProviderAdapter["listAgents"] = Effect.fn(
		"OpenClawAdapter.listAgents",
	)(function* (connection) {
		const auth = yield* authenticated(connection);
		const models = yield* catalog({ connection, ...auth });
		const agents = new Map<string, RuntimeAgent>();
		for (const model of models.data) {
			if (model.id === "openclaw") continue;
			if (!model.id.startsWith("openclaw/"))
				return yield* new RuntimeProtocolInvalid();
			const id = model.id.slice("openclaw/".length);
			if (!AgentId.test(id)) return yield* new RuntimeProtocolInvalid();
			agents.set(id, { id, name: id });
		}
		return [...agents.values()];
	});
	const health: RuntimeProviderAdapter["health"] = Effect.fn(
		"OpenClawAdapter.health",
	)((connection) =>
		Effect.scoped(
			Effect.gen(function* () {
				const auth = yield* authenticated(connection);
				const response = yield* options.http.execute({
					connection,
					...auth,
					path: "/readyz",
					method: "GET",
				});
				if (response.status === 503)
					return {
						status: "unavailable",
						lifecycle: "externallyManaged",
					} satisfies RuntimeHealth;
				const body = yield* readJson(response);
				const ready = yield* Schema.decodeUnknown(Ready)(body).pipe(
					Effect.mapError((cause) => new RuntimeProtocolInvalid(cause)),
				);
				if (!ready.ready)
					return {
						status: "unavailable",
						lifecycle: "externallyManaged",
					} satisfies RuntimeHealth;
				// A public readiness probe cannot establish bearer validity. The catalog can.
				yield* catalog({ connection, ...auth }).pipe(
					Effect.catchTag("RuntimeCapabilityUnsupported", () => Effect.void),
				);
				return {
					status: "ready",
					lifecycle: "externallyManaged",
				} satisfies RuntimeHealth;
			}),
		).pipe(
			Effect.catchTag("RuntimeAuthenticationFailed", () =>
				Effect.succeed({
					status: "authenticationRequired",
					lifecycle: "externallyManaged",
				} satisfies RuntimeHealth),
			),
			Effect.catchTag("RuntimeUnavailable", () =>
				Effect.succeed({
					status: "unavailable",
					lifecycle: "externallyManaged",
				} satisfies RuntimeHealth),
			),
			Effect.catchTag("RuntimeTimeout", () =>
				Effect.succeed({
					status: "unavailable",
					lifecycle: "externallyManaged",
				} satisfies RuntimeHealth),
			),
		),
	);
	const capabilities: RuntimeProviderAdapter["capabilities"] = Effect.fn(
		"OpenClawAdapter.capabilities",
	)(function* (connection) {
		const auth = yield* authenticated(connection);
		const protocol = yield* probeProtocol({ connection, ...auth }).pipe(
			Effect.as("supported" as const),
			Effect.catchTag("RuntimeCapabilityUnsupported", () =>
				Effect.succeed("unsupported" as const),
			),
		);
		const agents = yield* listAgents(connection).pipe(
			Effect.as("supported" as const),
			Effect.catchTag("RuntimeCapabilityUnsupported", () =>
				Effect.succeed("unsupported" as const),
			),
		);
		return {
			health: "supported",
			chat: protocol,
			listAgents: agents,
			sessions: "unsupported",
			resources: "unsupported",
			models: "unsupported",
			// Internal tool activity is absent from these HTTP APIs. Client function
			// requests are normalized if received, but aren't execution progress.
			toolEvents: "unsupported",
			usage: protocol === "supported" ? "unverified" : "unsupported",
		} satisfies RuntimeCapabilities;
	});
	const streamConversation: RuntimeProviderAdapter["streamConversation"] = (
		connection,
		request,
	) =>
		Stream.unwrapScoped(
			Effect.gen(function* () {
				if (
					!Schema.is(RuntimeConversationRequest)(request) ||
					request.connectionId !== connection.id
				)
					return yield* new RuntimeConnectionInvalid();
				if (request.agentId !== undefined && !AgentId.test(request.agentId))
					return yield* new RuntimeConnectionInvalid();
				const sessionId =
					request.sessionId ?? `open-quake:${request.conversationId}`;
				// Header values are validated before dispatch, independently of fetch behavior.
				if (
					sessionId.length > 256 ||
					unsafeHeader(sessionId) ||
					(request.modelId !== undefined && unsafeHeader(request.modelId))
				)
					return yield* new RuntimeConnectionInvalid();
				const auth = yield* authenticated(connection);
				const protocol = yield* probeProtocol({ connection, ...auth });
				const headers = {
					"content-type": "application/json",
					accept: "text/event-stream",
					"x-openclaw-session-key": sessionId,
					...(request.agentId === undefined
						? {}
						: { "x-openclaw-agent-id": request.agentId }),
					...(request.modelId === undefined
						? {}
						: { "x-openclaw-model": request.modelId }),
				};
				const model =
					request.agentId === undefined
						? "openclaw/default"
						: `openclaw/${request.agentId}`;
				const body =
					protocol === "responses"
						? {
								model,
								stream: true,
								input: request.messages.map((message) => ({
									type: "message",
									role: message.role,
									content: message.content,
								})),
							}
						: {
								model,
								stream: true,
								messages: request.messages,
								stream_options: { include_usage: true },
							};
				// This is the only dispatch. There is no protocol fallback after this point.
				const response = yield* options.http.execute({
					connection,
					...auth,
					path: protocolPath(protocol),
					method: "POST",
					headers,
					body,
				});
				if (response.status < 200 || response.status >= 300)
					return yield* statusError(response.status);
				const contentType = response.headers["content-type"]
					?.split(";")[0]
					?.trim()
					.toLowerCase();
				if (contentType !== "text/event-stream")
					return yield* new RuntimeProtocolInvalid();
				return Stream.succeed<RuntimeConversationEvent>({
					_tag: "status",
					kind: "session",
					text: "OpenClaw session selected",
					sessionId,
				}).pipe(
					Stream.concat(normalizeOpenClawStream(response, protocol, sessionId)),
				);
			}),
		);
	return {
		kind: "openclaw",
		health,
		capabilities,
		listAgents,
		streamConversation,
	};
}
