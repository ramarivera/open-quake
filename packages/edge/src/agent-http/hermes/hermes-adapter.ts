import { Effect, Schema, Stream } from "effect";
import {
	RuntimeConnection,
	RuntimeConversationEvent,
	RuntimeConversationRequest,
} from "../runtime-contracts.js";
import {
	RuntimeCapabilityUnsupported,
	RuntimeConnectionInvalid,
	RuntimeCredentialUnavailable,
	type RuntimeError,
	RuntimeProtocolInvalid,
} from "../runtime-errors.js";
import type {
	RuntimeCredentialResolver,
	RuntimeHttpLimits,
	RuntimeHttpRequest,
	RuntimeHttpResponse,
	RuntimeHttpTransport,
	RuntimeProviderAdapter,
} from "../runtime-ports.js";
import { parseSse, readJson } from "../transport.js";
import {
	decodeHermes,
	decodeHermesFrame,
	HermesCapabilities,
	HermesHealth,
	HermesModels,
	isHermesDone,
} from "./hermes-protocol.js";

const unsafeSessionId = (value: string): boolean =>
	value.includes("..") ||
	/^[a-z]:/iu.test(value) ||
	[...value].some(
		(char) =>
			char.charCodeAt(0) < 32 ||
			char.charCodeAt(0) === 127 ||
			char === "/" ||
			char === "\\",
	);

export interface HermesAdapterOptions {
	readonly transport: RuntimeHttpTransport;
	readonly credentials?: RuntimeCredentialResolver;
	readonly limits?: RuntimeHttpLimits;
}

/** Uses the agent API server, never the password-protected Hermes dashboard. */
export function makeHermesRuntimeAdapter(
	options: HermesAdapterOptions,
): RuntimeProviderAdapter {
	const execute = Effect.fn("Hermes.execute")(function* (
		connection: RuntimeConnection,
		path: string,
		method: "GET" | "POST" = "GET",
		extra: Pick<RuntimeHttpRequest, "headers" | "body"> = {},
	) {
		if (
			connection.kind !== "hermes" ||
			!Schema.is(RuntimeConnection)(connection)
		)
			return yield* Effect.fail(new RuntimeConnectionInvalid());
		const reference = connection.credentialRef;
		const resolveCredential =
			reference === undefined
				? Effect.succeed(undefined)
				: options.credentials
					? options.credentials.resolve(reference)
					: Effect.fail(new RuntimeCredentialUnavailable());
		const credential = yield* resolveCredential;
		return yield* options.transport.execute({
			connection,
			path,
			method,
			...options.limits,
			...extra,
			...(credential === undefined ? {} : { credential }),
		});
	});
	const discovery = Effect.fn("Hermes.discovery")(
		(connection: RuntimeConnection) =>
			Effect.scoped(
				Effect.gen(function* () {
					const response = yield* execute(connection, "/v1/capabilities");
					return yield* decodeHermes(
						HermesCapabilities,
						yield* readJson(response, options.limits),
					);
				}),
			),
	);
	const capabilities: RuntimeProviderAdapter["capabilities"] = Effect.fn(
		"Hermes.capabilities",
	)(function* (connection: RuntimeConnection) {
		const remote = yield* discovery(connection);
		const flags = remote.features;
		const chat =
			flags.chat_completions === true &&
			flags.chat_completions_streaming === true
				? "supported"
				: flags.chat_completions === false ||
						flags.chat_completions_streaming === false
					? "unsupported"
					: "unverified";
		return {
			health: "supported",
			chat,
			listAgents: "unsupported",
			sessions: "unsupported",
			resources: "unsupported",
			models: "supported",
			toolEvents:
				chat === "supported"
					? flags.tool_progress_events === true
						? "supported"
						: flags.tool_progress_events === false
							? "unsupported"
							: "unverified"
					: "unsupported",
			usage: chat === "supported" ? "supported" : "unverified",
		};
	});
	const listModels: NonNullable<RuntimeProviderAdapter["listModels"]> =
		Effect.fn("Hermes.listModels")(function* (connection: RuntimeConnection) {
			yield* discovery(connection);
			return yield* Effect.scoped(
				Effect.gen(function* () {
					const response = yield* execute(connection, "/v1/models");
					const models = yield* decodeHermes(
						HermesModels,
						yield* readJson(response, options.limits),
					);
					return models.data.map(({ id }) => ({ id, name: id }));
				}),
			);
		});
	const health: RuntimeProviderAdapter["health"] = Effect.fn("Hermes.health")(
		function* (connection: RuntimeConnection) {
			yield* discovery(connection);
			return yield* Effect.scoped(
				Effect.gen(function* () {
					const response = yield* execute(connection, "/health/detailed");
					const remote = yield* decodeHermes(
						HermesHealth,
						yield* readJson(response, options.limits),
					);
					return {
						status: remote.status === "ok" ? "ready" : "error",
						lifecycle: "externallyManaged",
					} as const;
				}),
			);
		},
	);
	const streamConversation = (
		connection: RuntimeConnection,
		request: RuntimeConversationRequest,
	): Stream.Stream<RuntimeConversationEvent, RuntimeError> =>
		Stream.unwrapScoped(
			Effect.gen(function* () {
				if (
					!Schema.is(RuntimeConversationRequest)(request) ||
					request.connectionId !== connection.id ||
					request.messages.at(-1)?.role !== "user"
				)
					return yield* Effect.fail(new RuntimeConnectionInvalid());
				if (request.agentId !== undefined)
					return yield* Effect.fail(new RuntimeCapabilityUnsupported());
				if (
					request.sessionId !== undefined &&
					unsafeSessionId(request.sessionId)
				)
					return yield* Effect.fail(new RuntimeConnectionInvalid());
				const remote = yield* discovery(connection);
				if (
					remote.features.chat_completions !== true ||
					remote.features.chat_completions_streaming !== true
				)
					return yield* Effect.fail(new RuntimeCapabilityUnsupported());
				if (request.modelId !== undefined) {
					const models = yield* listModels(connection);
					if (!models.some(({ id }) => id === request.modelId))
						return yield* Effect.fail(new RuntimeCapabilityUnsupported());
				}
				const response: RuntimeHttpResponse = yield* execute(
					connection,
					"/v1/chat/completions",
					"POST",
					{
						headers: {
							Accept: "text/event-stream",
							...(request.sessionId === undefined
								? {}
								: { "X-Hermes-Session-Id": request.sessionId }),
						},
						body: {
							model: request.modelId ?? remote.model,
							messages: request.messages,
							stream: true,
						},
					},
				);
				const sessionId = Object.entries(response.headers).find(
					([name]) => name.toLowerCase() === "x-hermes-session-id",
				)?.[1];
				if (
					sessionId !== undefined &&
					(!Schema.is(RuntimeConversationEvent)({
						_tag: "completed",
						sessionId,
					}) ||
						unsafeSessionId(sessionId))
				)
					return yield* Effect.fail(new RuntimeProtocolInvalid());
				const state = { finished: false, done: false };
				const events = parseSse(response, options.limits).pipe(
					Stream.takeUntil(isHermesDone),
					Stream.mapEffect((frame) => decodeHermesFrame(frame, state)),
					Stream.mapConcat((items) => items),
				);
				return events.pipe(
					Stream.concat(
						Stream.fromEffect(
							Effect.suspend(() =>
								state.finished && state.done
									? Effect.succeed<RuntimeConversationEvent>({
											_tag: "completed",
											...(sessionId === undefined ? {} : { sessionId }),
										})
									: Effect.fail(new RuntimeProtocolInvalid()),
							),
						),
					),
				);
			}),
		);
	return {
		kind: "hermes",
		health,
		capabilities,
		listModels,
		listAgents: Effect.fn("Hermes.listAgents")(
			(_connection: RuntimeConnection) =>
				Effect.fail(new RuntimeCapabilityUnsupported()),
		),
		streamConversation,
	};
}
