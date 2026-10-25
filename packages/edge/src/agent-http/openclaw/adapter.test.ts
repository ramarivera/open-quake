import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { Deferred, Effect, Either, Fiber, Redacted, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import type {
	RuntimeConnection,
	RuntimeConversationEvent,
	RuntimeConversationRequest,
} from "../runtime-contracts.js";
import { makeRuntimeHttpTransport } from "../transport.js";
import { makeOpenClawAdapter } from "./adapter.js";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
	for (const server of servers.splice(0)) {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});
async function fixture(handler: Handler): Promise<RuntimeConnection> {
	const server = createServer(handler);
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing fixture address");
	return {
		id: "gateway",
		name: "Fixture",
		kind: "openclaw",
		baseURL: `http://127.0.0.1:${address.port}/gateway/`,
	};
}
const request: RuntimeConversationRequest = {
	connectionId: "gateway",
	conversationId: "turn-1",
	agentId: "main",
	messages: [{ role: "user", content: "hello" }],
};
const responsesEvent = (
	type: string,
	data: Readonly<Record<string, unknown>>,
) => `event: ${type}\r\ndata: ${JSON.stringify({ type, ...data })}\r\n\r\n`;
const response = (overrides: Readonly<Record<string, unknown>> = {}) => ({
	id: "resp_1",
	status: "completed",
	output: [],
	...overrides,
});
const completed = () =>
	responsesEvent("response.completed", { response: response() }) +
	"data: [DONE]\r\n\r\n";
function sendSse(res: ServerResponse, wire: string, fragment = 7) {
	res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
	const bytes = Buffer.from(wire);
	for (let offset = 0; offset < bytes.length; offset += fragment)
		res.write(bytes.subarray(offset, offset + fragment));
	res.end();
}
const adapter = () => makeOpenClawAdapter({ http: makeRuntimeHttpTransport() });
const collect = (connection: RuntimeConnection, input = request) =>
	Effect.runPromise(
		adapter()
			.streamConversation(connection, input)
			.pipe(
				Stream.runCollect,
				Effect.map((events) => Array.from(events)),
			),
	);
const failure = async (connection: RuntimeConnection) => {
	const result = await Effect.runPromise(
		adapter()
			.streamConversation(connection, request)
			.pipe(Stream.runDrain, Effect.either),
	);
	expect(Either.isLeft(result)).toBe(true);
	if (Either.isRight(result)) throw new Error("Expected typed failure");
	return result.left;
};
const probe = (
	req: IncomingMessage,
	res: ServerResponse,
	enabled = "/v1/responses",
): boolean => {
	if (req.method !== "GET") return false;
	if (req.url === `/gateway${enabled}`)
		res.writeHead(405, { allow: "POST" }).end();
	else res.writeHead(404).end();
	return true;
};

describe("OpenClaw HTTP adapter", () => {
	it("uses bearer auth, base subpath, agent/model headers and persistent session routing", async () => {
		const seen: {
			method: string;
			url: string;
			auth: string | undefined;
			session: string | undefined;
			body: string;
		}[] = [];
		const connection = await fixture((req, res) => {
			let body = "";
			req.on("data", (chunk) => {
				body += String(chunk);
			});
			req.on("end", () => {
				seen.push({
					method: req.method ?? "",
					url: req.url ?? "",
					auth: req.headers.authorization,
					session:
						typeof req.headers["x-openclaw-session-key"] === "string"
							? req.headers["x-openclaw-session-key"]
							: undefined,
					body,
				});
				if (probe(req, res)) return;
				expect(req.headers["x-openclaw-agent-id"]).toBe("main");
				expect(req.headers["x-openclaw-model"]).toBe("provider/model");
				sendSse(
					res,
					responsesEvent("response.output_text.delta", { delta: "hi ☃" }) +
						responsesEvent("response.completed", {
							response: response({
								usage: { input_tokens: 12, output_tokens: 3 },
							}),
						}) +
						"data: [DONE]\r\n\r\n",
					1,
				);
			});
		});
		const configured = { ...connection, credentialRef: "secret-ref" };
		const a = makeOpenClawAdapter({
			http: makeRuntimeHttpTransport(),
			credentials: {
				resolve: () => Effect.succeed(Redacted.make("fixture-secret")),
			},
		});
		const events = await Effect.runPromise(
			a
				.streamConversation(configured, {
					...request,
					sessionId: "open-quake:stable",
					modelId: "provider/model",
				})
				.pipe(
					Stream.runCollect,
					Effect.map((events) => Array.from(events)),
				),
		);
		expect(events).toEqual([
			{
				_tag: "status",
				kind: "session",
				text: "OpenClaw session selected",
				sessionId: "open-quake:stable",
			},
			{ _tag: "textDelta", kind: "generation", textDelta: "hi ☃" },
			{
				_tag: "usage",
				usage: { inputTokens: 12, outputTokens: 3, provenance: "reported" },
			},
			{ _tag: "completed", sessionId: "open-quake:stable" },
		]);
		expect(seen.map((x) => [x.method, x.url])).toEqual([
			["GET", "/gateway/v1/responses"],
			["POST", "/gateway/v1/responses"],
		]);
		expect(seen.every((x) => x.auth === "Bearer fixture-secret")).toBe(true);
		const dispatched = JSON.parse(seen[1]?.body ?? "{}");
		expect(dispatched).toEqual({
			model: "openclaw/main",
			stream: true,
			input: [{ type: "message", role: "user", content: "hello" }],
		});
	});
	it("creates and returns a stable first-turn gateway key without inventing usage", async () => {
		const c = await fixture((req, res) => {
			if (!probe(req, res)) sendSse(res, completed());
		});
		const events = await collect(c);
		expect(events.filter((x) => x._tag === "usage")).toEqual([]);
		expect(events.at(-1)).toEqual({
			_tag: "completed",
			sessionId: "open-quake:turn-1",
		});
	});
	it("normalizes actual function requests once and never fabricates execution", async () => {
		const call = {
			type: "function_call",
			call_id: "call_1",
			name: "lookup",
			arguments: '{"q":"test"}',
		};
		const c = await fixture((req, res) => {
			if (!probe(req, res))
				sendSse(
					res,
					responsesEvent("response.output_item.done", { item: call }) +
						responsesEvent("response.completed", {
							response: response({ output: [call] }),
						}) +
						"data: [DONE]\n\n",
				);
		});
		const events = await collect(c);
		expect(events.filter((x) => x._tag === "tool")).toEqual([
			{
				_tag: "tool",
				toolCallId: "call_1",
				tool: "lookup",
				phase: "requested",
				arguments: '{"q":"test"}',
			},
		]);
	});
	it.each(["response.failed", "response.incomplete"])(
		"fails %s without successful completion",
		async (type) => {
			const c = await fixture((req, res) => {
				if (!probe(req, res))
					sendSse(
						res,
						`${responsesEvent(type, {
							response: response({ status: type.slice(9) }),
						})}data: [DONE]\n\n`,
					);
			});
			expect((await failure(c))._tag).toBe("RuntimeRequestFailed");
		},
	);
	it.each([
		[
			"truncated",
			responsesEvent("response.output_text.delta", { delta: "partial" }),
		],
		[
			"missing DONE",
			responsesEvent("response.completed", { response: response() }),
		],
		["premature DONE", "data: [DONE]\n\n"],
		["malformed JSON", "data: {oops}\n\n"],
		[
			"event mismatch",
			'event: response.in_progress\ndata: {"type":"response.completed"}\n\n',
		],
		[
			"invalid usage",
			responsesEvent("response.completed", {
				response: response({ usage: { input_tokens: -1, output_tokens: 2 } }),
			}),
		],
	])("rejects %s", async (_name, wire) => {
		const c = await fixture((req, res) => {
			if (!probe(req, res)) sendSse(res, wire);
		});
		expect((await failure(c))._tag).toBe("RuntimeProtocolInvalid");
	});
	it("discovers chat via GET before one POST and assembles real tool arguments/usage", async () => {
		const methods: string[] = [];
		const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
		const choice = (delta: unknown, finish_reason: unknown = null) => ({
			choices: [{ index: 0, delta, finish_reason }],
		});
		const c = await fixture((req, res) => {
			methods.push(`${req.method} ${req.url}`);
			if (probe(req, res, "/v1/chat/completions")) return;
			sendSse(
				res,
				frame(choice({ role: "assistant" })) +
					frame(choice({ content: "Working" })) +
					frame(
						choice({
							tool_calls: [
								{
									index: 0,
									id: "call_a",
									function: { name: "lookup", arguments: "" },
								},
							],
						}),
					) +
					frame(
						choice({
							tool_calls: [{ index: 0, function: { arguments: '{"q":"a"}' } }],
						}),
					) +
					frame(choice({}, "tool_calls")) +
					frame({
						choices: [],
						usage: { prompt_tokens: 4, completion_tokens: 7 },
					}) +
					"data: [DONE]\n\n",
			);
		});
		const events = await collect(c);
		expect(methods).toEqual([
			"GET /gateway/v1/responses",
			"GET /gateway/v1/chat/completions",
			"POST /gateway/v1/chat/completions",
		]);
		expect(events.filter((x) => x._tag === "tool")).toEqual([
			{
				_tag: "tool",
				toolCallId: "call_a",
				tool: "lookup",
				phase: "requested",
				arguments: '{"q":"a"}',
			},
		]);
		expect(events.filter((x) => x._tag === "usage")).toEqual([
			{
				_tag: "usage",
				usage: { inputTokens: 4, outputTokens: 7, provenance: "reported" },
			},
		]);
		expect(events.at(-1)?._tag).toBe("completed");
	});

	it.each([
		[
			"length",
			{ choices: [{ index: 0, delta: {}, finish_reason: "length" }] },
			"RuntimeRequestFailed",
		],
		[
			"missing finish",
			{
				choices: [
					{ index: 0, delta: { content: "partial" }, finish_reason: null },
				],
			},
			"RuntimeProtocolInvalid",
		],
		[
			"server error",
			{ error: { message: "provider secret", type: "api_error" } },
			"RuntimeRequestFailed",
		],
	])("rejects chat %s without completion", async (_label, payload, tag) => {
		const c = await fixture((req, res) => {
			if (!probe(req, res, "/v1/chat/completions"))
				sendSse(res, `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
		});
		const error = await failure(c);
		expect(error._tag).toBe(tag);
		expect(JSON.stringify(error)).not.toContain("provider secret");
	});
	it("rejects malformed function requests instead of dropping them", async () => {
		const c = await fixture((req, res) => {
			if (!probe(req, res))
				sendSse(
					res,
					responsesEvent("response.output_item.done", {
						item: { type: "function_call", name: "lookup", arguments: "{}" },
					}) + completed(),
				);
		});
		expect((await failure(c))._tag).toBe("RuntimeProtocolInvalid");
	});
	it("waits for valid EOF before emitting success", async () => {
		const c = await fixture((req, res) => {
			if (!probe(req, res)) sendSse(res, `${completed()}data: [DONE]\n\n`);
		});
		const seen: RuntimeConversationEvent[] = [];
		const result = await Effect.runPromise(
			adapter()
				.streamConversation(c, request)
				.pipe(
					Stream.runForEach((event) =>
						Effect.sync(() => {
							seen.push(event);
						}),
					),
					Effect.either,
				),
		);
		expect(Either.isLeft(result) && result.left._tag).toBe(
			"RuntimeProtocolInvalid",
		);
		expect(seen.some((event) => event._tag === "completed")).toBe(false);
	});
	it("never retries or switches protocol after a dispatched error", async () => {
		let posts = 0;
		const c = await fixture((req, res) => {
			if (probe(req, res)) return;
			posts++;
			res
				.writeHead(500, { "content-type": "application/json" })
				.end('{"error":{"message":"secret upstream detail"}}');
		});
		const error = await failure(c);
		expect(error._tag).toBe("RuntimeRequestFailed");
		expect(JSON.stringify(error)).not.toContain("secret upstream detail");
		expect(posts).toBe(1);
	});
	it.each([401, 403])(
		"maps HTTP %s to safe typed authentication failure",
		async (status) => {
			const c = await fixture((req, res) => {
				if (!probe(req, res)) res.writeHead(status).end("private");
			});
			const error = await failure(c);
			expect(error._tag).toBe("RuntimeAuthenticationFailed");
			expect(error.code).toBe("AGENT.HTTP.AUTH.FAILED");
			expect(JSON.stringify(error)).not.toContain("private");
		},
	);
	it("enumerates only source-backed agent targets and reports honest capabilities", async () => {
		const c = await fixture((req, res) => {
			if (req.url === "/gateway/v1/models")
				res.writeHead(200, { "content-type": "application/json" }).end(
					JSON.stringify({
						object: "list",
						data: [
							"openclaw",
							"openclaw/default",
							"openclaw/main",
							"openclaw/research",
						].map((id) => ({ id, object: "model", owned_by: "openclaw" })),
					}),
				);
			else probe(req, res);
		});
		expect(await Effect.runPromise(adapter().listAgents(c))).toEqual([
			{ id: "default", name: "default" },
			{ id: "main", name: "main" },
			{ id: "research", name: "research" },
		]);
		const caps = await Effect.runPromise(adapter().capabilities(c));
		expect(caps).toMatchObject({
			chat: "supported",
			listAgents: "supported",
			models: "unsupported",
			sessions: "unsupported",
			resources: "unsupported",
			toolEvents: "unsupported",
			usage: "unverified",
		});
		expect(adapter().listModels).toBeUndefined();
	});
	it("doesn't fabricate agents when an older gateway lacks a catalog", async () => {
		const c = await fixture((req, res) => {
			probe(req, res);
		});
		const result = await Effect.runPromise(
			adapter().listAgents(c).pipe(Effect.either),
		);
		expect(Either.isLeft(result) && result.left._tag).toBe(
			"RuntimeCapabilityUnsupported",
		);
	});
	it("doesn't equate a public ready probe with valid credentials", async () => {
		const c = await fixture((req, res) => {
			if (req.url === "/gateway/readyz")
				res
					.writeHead(200, { "content-type": "application/json" })
					.end('{"ready":true}');
			else res.writeHead(401).end();
		});
		expect(await Effect.runPromise(adapter().health(c))).toEqual({
			status: "authenticationRequired",
			lifecycle: "externallyManaged",
		});
	});
	it("rejects unsafe inputs and missing credential resolution before dispatch", async () => {
		let calls = 0;
		const c = await fixture((_req, res) => {
			calls++;
			res.end();
		});
		await expect(
			collect(c, { ...request, connectionId: "other" }),
		).rejects.toThrow();
		await expect(
			collect(c, { ...request, sessionId: "bad\r\nheader" }),
		).rejects.toThrow();
		expect((await failure({ ...c, credentialRef: "missing" }))._tag).toBe(
			"RuntimeAuthenticationFailed",
		);
		expect(calls).toBe(0);
	});
	it("physically aborts a pending HTTP stream when its Effect fiber is interrupted", async () => {
		let close!: () => void;
		const closed = new Promise<void>((resolve) => {
			close = resolve;
		});
		const c = await fixture((req, res) => {
			if (probe(req, res)) return;
			res.on("close", close);
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.write(
				responsesEvent("response.output_text.delta", { delta: "first" }),
			);
		});
		await Effect.runPromise(
			Effect.gen(function* () {
				const received = yield* Deferred.make<void>();
				const fiber = yield* adapter()
					.streamConversation(c, request)
					.pipe(
						Stream.runForEach((event: RuntimeConversationEvent) =>
							event._tag === "textDelta"
								? Deferred.succeed(received, undefined)
								: Effect.void,
						),
						Effect.fork,
					);
				yield* Deferred.await(received);
				yield* Fiber.interrupt(fiber);
			}),
		);
		await closed;
	});
});
