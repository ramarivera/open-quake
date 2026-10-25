import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Either, Redacted, Stream } from "effect";
import { makeHermesRuntimeAdapter } from "./hermes/hermes-adapter.js";
import { makeOpenClawAdapter } from "./openclaw/index.js";
import type {
	RuntimeConnection,
	RuntimeConversationEvent,
	RuntimeConversationRequest,
} from "./runtime-contracts.js";
import type { RuntimeProviderAdapter } from "./runtime-ports.js";
import { makeRuntimeHttpTransport } from "./transport.js";
import { fixture } from "./transport-fixtures.js";

// Primary sources: Hermes 0.21.3 e10934b, gateway/platforms/api_server*.py;
// OpenClaw 2026.10.7 384100f4, src/gateway/{models,openai,openresponses}-http.ts.
// These servers are protocol fixtures. They never contact a running agent/model.
const releases: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const release of releases.splice(0)) await release();
});
async function server(handler: Parameters<typeof fixture>[0]) {
	const result = await fixture(handler);
	releases.push(result.close);
	return result;
}
const connection = (
	baseURL: string,
	kind: RuntimeConnection["kind"],
): RuntimeConnection => ({
	id: "acceptance",
	name: "Local fixture",
	kind,
	baseURL: `${baseURL}/gateway/`,
	credentialRef: "fixture-credential",
});
const credentials = {
	resolve: () => Effect.succeed(Redacted.make("acceptance-inert-secret")),
};
const http = makeRuntimeHttpTransport();
const input: RuntimeConversationRequest = {
	connectionId: "acceptance",
	conversationId: "disposable-acceptance",
	messages: [{ role: "user", content: "Hello" }],
};
const collect = (
	adapter: RuntimeProviderAdapter,
	configured: RuntimeConnection,
	request = input,
) =>
	Effect.runPromise(
		adapter.streamConversation(configured, request).pipe(
			Stream.runCollect,
			Effect.map((events) => Array.from(events)),
		),
	);
const json = (response: ServerResponse, body: unknown) => {
	response.writeHead(200, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
};
const sse = (body: unknown, event?: string) =>
	`${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(body)}\n\n`;
const chunk = (delta: string, finished = false) => ({
	object: "chat.completion.chunk",
	choices: [
		{
			index: 0,
			delta: { content: delta },
			finish_reason: finished ? "stop" : null,
		},
	],
	...(finished ? { usage: { prompt_tokens: 8, completion_tokens: 2 } } : {}),
});
const hermesCapabilities = {
	object: "hermes.api_server.capabilities",
	platform: "hermes-agent",
	model: "hermes-agent",
	features: {
		chat_completions: true,
		chat_completions_streaming: true,
		tool_progress_events: true,
	},
};
async function body(request: IncomingMessage): Promise<unknown> {
	let value = "";
	for await (const part of request) value += String(part);
	return JSON.parse(value);
}

describe("agent HTTP acceptance with real adapters and fetch transport", () => {
	it("uses Hermes identity, aliases and real session/tool events without inventing agents", async () => {
		const posts: Array<{
			session: string | string[] | undefined;
			body: unknown;
		}> = [];
		const auth: Array<string | undefined> = [];
		const remote = await server(async (req, res) => {
			auth.push(req.headers.authorization);
			if (req.url === "/gateway/v1/capabilities")
				return json(res, hermesCapabilities);
			if (req.url === "/gateway/health/detailed")
				return json(res, { status: "ok", platform: "hermes-agent" });
			if (req.url === "/gateway/v1/models")
				return json(res, {
					object: "list",
					data: [{ id: "fast-route", object: "model" }],
				});
			if (req.method !== "POST" || req.url !== "/gateway/v1/chat/completions")
				return res.writeHead(404).end();
			posts.push({
				session: req.headers["x-hermes-session-id"],
				body: await body(req),
			});
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"x-hermes-session-id": "hermes-session",
			});
			res.end(
				sse({ kind: "working", text: "Working" }, "hermes.status") +
					sse(
						{ tool: "fixture", toolCallId: "call-1", status: "running" },
						"hermes.tool.progress",
					) +
					sse(
						{ tool: "fixture", toolCallId: "call-1", status: "completed" },
						"hermes.tool.progress",
					) +
					sse(chunk("Hello ☃")) +
					sse(chunk("", true)) +
					"data: [DONE]\n\n",
			);
		});
		const configured = connection(remote.baseURL, "hermes");
		const adapter = makeHermesRuntimeAdapter({ transport: http, credentials });
		expect(await Effect.runPromise(adapter.health(configured))).toEqual({
			status: "ready",
			lifecycle: "externallyManaged",
		});
		expect(
			await Effect.runPromise(adapter.capabilities(configured)),
		).toMatchObject({
			chat: "supported",
			listAgents: "unsupported",
			resources: "unsupported",
		});
		const agents = await Effect.runPromise(
			adapter.listAgents(configured).pipe(Effect.either),
		);
		expect(Either.isLeft(agents) && agents.left._tag).toBe(
			"RuntimeCapabilityUnsupported",
		);
		expect(adapter.listResources).toBeUndefined();
		const events = await collect(adapter, configured, {
			...input,
			modelId: "fast-route",
		});
		expect(events.filter((event) => event._tag === "textDelta")).toEqual([
			{ _tag: "textDelta", kind: "generation", textDelta: "Hello ☃" },
		]);
		expect(
			events
				.filter((event) => event._tag === "tool")
				.map((event) => event.phase),
		).toEqual(["running", "completed"]);
		expect(events.filter((event) => event._tag === "usage")).toEqual([
			{
				_tag: "usage",
				usage: { inputTokens: 8, outputTokens: 2, provenance: "reported" },
			},
		]);
		expect(events.filter((event) => event._tag === "completed")).toEqual([
			{ _tag: "completed", sessionId: "hermes-session" },
		]);
		await collect(adapter, configured, {
			...input,
			sessionId: "hermes-session",
		});
		expect(posts).toHaveLength(2);
		expect(posts[0]?.body).toMatchObject({
			model: "fast-route",
			messages: input.messages,
			stream: true,
		});
		expect(posts[1]?.session).toBe("hermes-session");
		expect(
			auth.every((value) => value === "Bearer acceptance-inert-secret"),
		).toBe(true);
	});

	for (const protocol of ["responses", "chatCompletions"] as const)
		it(`discovers OpenClaw agents and completes ${protocol} once with the selected session`, async () => {
			const path =
				protocol === "responses" ? "/v1/responses" : "/v1/chat/completions";
			const posts: Array<{
				session: string | string[] | undefined;
				body: unknown;
			}> = [];
			const remote = await server(async (req, res) => {
				if (req.headers.authorization !== "Bearer acceptance-inert-secret")
					return res.writeHead(401).end();
				if (req.url === "/gateway/readyz") return json(res, { ready: true });
				if (req.url === "/gateway/v1/models")
					return json(res, {
						object: "list",
						data: ["default", "writer"].map((id) => ({
							id: `openclaw/${id}`,
							object: "model",
							owned_by: "openclaw",
						})),
					});
				if (req.url !== `/gateway${path}`) return res.writeHead(404).end();
				if (req.method === "GET")
					return res.writeHead(405, { allow: "POST" }).end();
				posts.push({
					session: req.headers["x-openclaw-session-key"],
					body: await body(req),
				});
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.end(
					protocol === "responses"
						? sse(
								{ type: "response.output_text.delta", delta: "Hello" },
								"response.output_text.delta",
							) +
								sse(
									{
										type: "response.completed",
										response: {
											id: "response-is-not-session",
											status: "completed",
											output: [],
											usage: { input_tokens: 8, output_tokens: 2 },
										},
									},
									"response.completed",
								) +
								"data: [DONE]\n\n"
						: `${sse(chunk("Hello"))}${sse(chunk("", true))}data: [DONE]\n\n`,
				);
			});
			const configured = connection(remote.baseURL, "openclaw");
			const adapter = makeOpenClawAdapter({ http, credentials, protocol });
			expect(await Effect.runPromise(adapter.health(configured))).toEqual({
				status: "ready",
				lifecycle: "externallyManaged",
			});
			expect(await Effect.runPromise(adapter.listAgents(configured))).toEqual([
				{ id: "default", name: "default" },
				{ id: "writer", name: "writer" },
			]);
			expect(
				await Effect.runPromise(adapter.capabilities(configured)),
			).toMatchObject({
				chat: "supported",
				listAgents: "supported",
				models: "unsupported",
				resources: "unsupported",
				toolEvents: "unsupported",
			});
			const events = await collect(adapter, configured, {
				...input,
				agentId: "writer",
				sessionId: "open-quake:disposable",
			});
			expect(events.filter((event) => event._tag === "completed")).toEqual([
				{ _tag: "completed", sessionId: "open-quake:disposable" },
			]);
			expect(events.filter((event) => event._tag === "tool")).toEqual([]);
			expect(events.filter((event) => event._tag === "textDelta")).toEqual([
				{ _tag: "textDelta", kind: "generation", textDelta: "Hello" },
			]);
			expect(posts).toHaveLength(1);
			expect(posts[0]?.session).toBe("open-quake:disposable");
			expect(posts[0]?.body).toMatchObject({
				model: "openclaw/writer",
				stream: true,
			});
		});

	for (const kind of ["hermes", "openclaw"] as const)
		it(`rejects a ${kind} dashboard redirect without forwarding a credential or starting chat`, async () => {
			let forwarded = 0;
			const target = await server((_req, res) => {
				forwarded++;
				res.writeHead(200).end("login");
			});
			const methods: Array<string | undefined> = [];
			const remote = await server((req, res) => {
				methods.push(req.method);
				res.writeHead(302, { location: `${target.baseURL}/login` }).end();
			});
			const configured = connection(remote.baseURL, kind);
			const adapter =
				kind === "hermes"
					? makeHermesRuntimeAdapter({ transport: http, credentials })
					: makeOpenClawAdapter({ http, credentials });
			const events: RuntimeConversationEvent[] = [];
			const result = await Effect.runPromise(
				adapter.streamConversation(configured, input).pipe(
					Stream.tap((event) => Effect.sync(() => events.push(event))),
					Stream.runDrain,
					Effect.either,
				),
			);
			expect(Either.isLeft(result)).toBe(true);
			expect(forwarded).toBe(0);
			expect(methods).toEqual(["GET"]);
			expect(events).toEqual([]);
			expect(JSON.stringify(result)).not.toContain("acceptance-inert-secret");
		});
});
