import { describe, expect, it } from "@effect/vitest";
import { Chunk, Deferred, Effect, Fiber, Redacted, Stream } from "effect";
import type {
	RuntimeConnection,
	RuntimeConversationRequest,
} from "../runtime-contracts.js";
import type {
	RuntimeHttpRequest,
	RuntimeHttpResponse,
	RuntimeHttpTransport,
} from "../runtime-ports.js";
import { makeHermesRuntimeAdapter } from "./hermes-adapter.js";

// Source-shaped fixtures: installed Hermes 0.21.3, api_server.py:2285-2368
// and api_server_openai_routes.py:817-887. No running service or device is used.
const connection: RuntimeConnection = {
	id: "hermes",
	name: "Local Hermes",
	kind: "hermes",
	baseURL: "http://localhost:8642/p/default/",
	credentialRef: "key-ref",
};
const request: RuntimeConversationRequest = {
	connectionId: "hermes",
	conversationId: "turn-1",
	messages: [{ role: "user", content: "Hello" }],
};
const capabilities = {
	object: "hermes.api_server.capabilities",
	platform: "hermes-agent",
	model: "hermes-agent",
	features: {
		chat_completions: true,
		chat_completions_streaming: true,
		tool_progress_events: true,
	},
};
const chunk = (
	content: string | undefined,
	finish: string | null = null,
	extra: object = {},
) => ({
	object: "chat.completion.chunk",
	choices: [
		{
			index: 0,
			delta: content === undefined ? {} : { content },
			finish_reason: finish,
		},
	],
	...extra,
});
const frame = (data: unknown, event?: string) =>
	`${event ? `event: ${event}\r\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\r\n\r\n`;
const terminal =
	frame(
		chunk(undefined, "stop", {
			usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
		}),
	) + frame("[DONE]");
const response = (
	body: string,
	contentType = "application/json",
	status = 200,
	headers: Record<string, string> = {},
): RuntimeHttpResponse => {
	const bytes = new TextEncoder().encode(body);
	return {
		status,
		headers: { "content-type": contentType, ...headers },
		body: Stream.fromIterable(
			Array.from({ length: Math.ceil(bytes.length / 3) }, (_, i) =>
				bytes.slice(i * 3, i * 3 + 3),
			),
		),
	};
};
const fixture = (
	overrides: {
		capabilities?: unknown;
		stream?: string;
		status?: number;
		health?: string;
		session?: string;
		streamBody?: RuntimeHttpResponse["body"];
	} = {},
) => {
	const calls: RuntimeHttpRequest[] = [];
	let releases = 0;
	const transport: RuntimeHttpTransport = {
		execute: (input) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					calls.push(input);
					if (input.path === "/v1/capabilities")
						return response(
							JSON.stringify(overrides.capabilities ?? capabilities),
							"application/json",
							overrides.status ?? 200,
						);
					if (input.path === "/health/detailed")
						return response(
							JSON.stringify({
								status: overrides.health ?? "ok",
								platform: "hermes-agent",
								version: "0.21.3",
							}),
						);
					if (input.path === "/v1/models")
						return response(
							JSON.stringify({
								object: "list",
								data: [
									{ id: "hermes-agent", object: "model" },
									{
										id: "fast",
										object: "model",
										root: "actual-model",
										parent: "hermes-agent",
									},
								],
							}),
						);
					const streamResponse = response(
						overrides.stream ?? frame(chunk("Héllo")) + terminal,
						"text/event-stream",
						200,
						{ "X-Hermes-Session-Id": overrides.session ?? "api-session-1" },
					);
					return overrides.streamBody
						? { ...streamResponse, body: overrides.streamBody }
						: streamResponse;
				}),
				() =>
					Effect.sync(() => {
						releases++;
					}),
			),
	};
	return {
		adapter: makeHermesRuntimeAdapter({
			transport,
			credentials: {
				resolve: () => Effect.succeed(Redacted.make("fixture-token")),
			},
		}),
		calls,
		releases: () => releases,
	};
};

describe("Hermes source-backed HTTP adapter", () => {
	it.effect(
		"checks authenticated identity and detailed readiness without lifecycle commands",
		() =>
			Effect.gen(function* () {
				const f = fixture();
				expect(yield* f.adapter.health(connection)).toEqual({
					status: "ready",
					lifecycle: "externallyManaged",
				});
				expect(f.calls.map(({ path }) => path)).toEqual([
					"/v1/capabilities",
					"/health/detailed",
				]);
				expect(
					f.calls.every(
						({ credential }) =>
							credential !== undefined &&
							Redacted.value(credential) === "fixture-token",
					),
				).toBe(true);
				expect(f.releases()).toBe(2);
			}),
	);
	it.effect(
		"doesn't mistake dashboard health or a generic OpenAI server for Hermes",
		() =>
			Effect.gen(function* () {
				for (const remote of [
					{ status: "ok" },
					{ object: "list", data: [] },
					{ ...capabilities, platform: "another-agent" },
				]) {
					const f = fixture({ capabilities: remote });
					const result = yield* f.adapter
						.health(connection)
						.pipe(Effect.either);
					expect(result._tag === "Left" && result.left.code).toBe(
						"AGENT.HTTP.PROTOCOL.INVALID",
					);
					expect(f.calls).toHaveLength(1);
				}
			}),
	);
	it.effect(
		"keeps capabilities truthful and model aliases separate from agent catalogs",
		() =>
			Effect.gen(function* () {
				const f = fixture();
				expect(yield* f.adapter.capabilities(connection)).toEqual({
					health: "supported",
					chat: "supported",
					listAgents: "unsupported",
					sessions: "unsupported",
					resources: "unsupported",
					models: "supported",
					toolEvents: "supported",
					usage: "supported",
				});
				const agents = yield* f.adapter
					.listAgents(connection)
					.pipe(Effect.either);
				expect(agents._tag === "Left" && agents.left.code).toBe(
					"AGENT.HTTP.CAPABILITY.UNSUPPORTED",
				);
				expect(
					yield* Effect.fromNullable(f.adapter.listModels).pipe(
						Effect.flatMap((list) => list(connection)),
					),
				).toEqual([
					{ id: "hermes-agent", name: "hermes-agent" },
					{ id: "fast", name: "fast" },
				]);
			}),
	);
	it.effect(
		"preserves actual text, status, tool progress, reported usage and remote session id",
		() =>
			Effect.gen(function* () {
				const stream =
					frame({ kind: "lifecycle", text: "Working" }, "hermes.status") +
					frame(
						{
							tool: "read_file",
							toolCallId: "call-1",
							status: "running",
							label: "Read file",
						},
						"hermes.tool.progress",
					) +
					frame(chunk("Héllo")) +
					frame(
						{ tool: "read_file", toolCallId: "call-1", status: "completed" },
						"hermes.tool.progress",
					) +
					terminal;
				const f = fixture({ stream });
				const events = yield* Stream.runCollect(
					f.adapter.streamConversation(connection, {
						...request,
						modelId: "fast",
						sessionId: "prior-session",
						messages: [
							{ role: "user", content: "Prior" },
							{ role: "assistant", content: "Reply" },
							{ role: "user", content: "Next" },
						],
					}),
				);
				expect(Chunk.toReadonlyArray(events)).toEqual([
					{ _tag: "status", kind: "lifecycle", text: "Working" },
					{
						_tag: "tool",
						tool: "read_file",
						toolCallId: "call-1",
						phase: "running",
						label: "Read file",
					},
					{ _tag: "textDelta", kind: "generation", textDelta: "Héllo" },
					{
						_tag: "tool",
						tool: "read_file",
						toolCallId: "call-1",
						phase: "completed",
					},
					{
						_tag: "usage",
						usage: { inputTokens: 12, outputTokens: 7, provenance: "reported" },
					},
					{ _tag: "completed", sessionId: "api-session-1" },
				]);
				const sent = f.calls.find(({ method }) => method === "POST");
				expect(sent?.headers?.["X-Hermes-Session-Id"]).toBe("prior-session");
				expect(sent?.body).toEqual({
					model: "fast",
					stream: true,
					messages: [
						{ role: "user", content: "Prior" },
						{ role: "assistant", content: "Reply" },
						{ role: "user", content: "Next" },
					],
				});
				expect(f.releases()).toBe(f.calls.length);
			}),
	);
	it.effect(
		"unknown capabilities stay unverified and disabled streaming never submits chat",
		() =>
			Effect.gen(function* () {
				const f = fixture({ capabilities: { ...capabilities, features: {} } });
				expect((yield* f.adapter.capabilities(connection)).chat).toBe(
					"unverified",
				);
				const result = yield* Stream.runCollect(
					f.adapter.streamConversation(connection, request),
				).pipe(Effect.either);
				expect(result._tag === "Left" && result.left.code).toBe(
					"AGENT.HTTP.CAPABILITY.UNSUPPORTED",
				);
				expect(f.calls.some(({ method }) => method === "POST")).toBe(false);
			}),
	);
	it.effect(
		"rejects unsupported agents, mismatched connections and unsafe session ids before network work",
		() =>
			Effect.gen(function* () {
				for (const invalid of [
					{ ...request, agentId: "fake-agent" },
					{ ...request, connectionId: "different" },
					{ ...request, sessionId: "../private" },
				]) {
					const f = fixture();
					expect(
						(yield* Stream.runCollect(
							f.adapter.streamConversation(connection, invalid),
						).pipe(Effect.either))._tag,
					).toBe("Left");
					expect(f.calls).toHaveLength(0);
				}
			}),
	);
	it.effect("rejects unadvertised model aliases without submitting chat", () =>
		Effect.gen(function* () {
			const f = fixture();
			const result = yield* Stream.runCollect(
				f.adapter.streamConversation(connection, {
					...request,
					modelId: "unknown",
				}),
			).pipe(Effect.either);
			expect(result._tag === "Left" && result.left.code).toBe(
				"AGENT.HTTP.CAPABILITY.UNSUPPORTED",
			);
			expect(f.calls.some(({ method }) => method === "POST")).toBe(false);
		}),
	);
	it.effect(
		"propagates authentication errors without serializing remote error text",
		() =>
			Effect.gen(function* () {
				const f = fixture({
					status: 401,
					capabilities: { error: { message: "secret-remote-text" } },
				});
				const result = yield* f.adapter.health(connection).pipe(Effect.either);
				expect(result._tag === "Left" && result.left.code).toBe(
					"AGENT.HTTP.AUTH.FAILED",
				);
				expect(JSON.stringify(result)).not.toContain("secret-remote-text");
			}),
	);
	it.effect("degraded authenticated health doesn't claim readiness", () =>
		Effect.gen(function* () {
			expect(
				(yield* fixture({ health: "degraded" }).adapter.health(connection))
					.status,
			).toBe("error");
		}),
	);
	for (const [name, stream, code] of [
		["early EOF", frame(chunk("partial")), "AGENT.HTTP.PROTOCOL.INVALID"],
		[
			"missing DONE",
			frame(chunk(undefined, "stop")),
			"AGENT.HTTP.PROTOCOL.INVALID",
		],
		["DONE without finish", frame("[DONE]"), "AGENT.HTTP.PROTOCOL.INVALID"],
		["malformed JSON", frame("{bad"), "AGENT.HTTP.PROTOCOL.INVALID"],
		["invalid chunk", frame({ choices: [] }), "AGENT.HTTP.PROTOCOL.INVALID"],
		[
			"truncated output",
			frame(chunk(undefined, "length")) + frame("[DONE]"),
			"AGENT.HTTP.REQUEST.FAILED",
		],
		[
			"server error",
			frame(chunk(undefined, "error", { error: { message: "private" } })) +
				frame("[DONE]"),
			"AGENT.HTTP.REQUEST.FAILED",
		],
	] as const)
		it.effect(`never completes successfully after ${name}`, () =>
			Effect.gen(function* () {
				const f = fixture({ stream });
				const seen: string[] = [];
				const result = yield* f.adapter
					.streamConversation(connection, request)
					.pipe(
						Stream.tap((event) => Effect.sync(() => seen.push(event._tag))),
						Stream.runDrain,
						Effect.either,
					);
				expect(result._tag === "Left" && result.left.code).toBe(code);
				expect(seen).not.toContain("completed");
				expect(f.releases()).toBe(f.calls.length);
			}),
		);
	it.effect(
		"interruption closes the active response scope while waiting for bytes",
		() =>
			Effect.gen(function* () {
				const waiting = yield* Deferred.make<void>();
				const f = fixture({
					streamBody: Stream.fromEffect(
						Deferred.succeed(waiting, undefined),
					).pipe(Stream.drain, Stream.concat(Stream.never)),
				});
				const fiber = yield* f.adapter
					.streamConversation(connection, request)
					.pipe(Stream.runDrain, Effect.fork);
				yield* Deferred.await(waiting);
				yield* Fiber.interrupt(fiber);
				expect(f.calls.at(-1)?.path).toBe("/v1/chat/completions");
				expect(f.releases()).toBe(f.calls.length);
			}),
	);
});
