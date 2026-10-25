import { EventEmitter } from "node:events";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import {
	Chunk,
	Effect,
	Fiber,
	Layer,
	ManagedRuntime,
	Schema,
	Stream,
} from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	type ConversationEvent,
	type ConversationResolution,
	ConversationRuntimePort,
	ConversationService,
} from "../../../../../packages/edge/src/agent-http/conversation-service.js";
import {
	RuntimeConversationEvent,
	RuntimeConversationRequest,
	type RuntimeKind,
} from "../../../../../packages/edge/src/agent-http/runtime-contracts.js";
import {
	RuntimeAuthenticationFailed,
	RuntimeCapabilityUnsupported,
	RuntimeProtocolInvalid,
	RuntimeRequestFailed,
} from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import type { RuntimeProviderAdapter } from "../../../../../packages/edge/src/agent-http/runtime-ports.js";
import {
	AGENT_CONVERSATIONS_REQUEST,
	type ConversationReply,
} from "../../shared/agent-conversations.js";
import { createConversationController } from "./conversation-controller.js";

interface FixtureInvokeEvent {
	readonly sender: FixtureWebContents;
	readonly senderFrame: { readonly url: string };
}
const electron = vi.hoisted(() => ({
	handle:
		vi.fn<
			(
				channel: string,
				handler: (
					event: FixtureInvokeEvent,
					input: unknown,
				) => Promise<ConversationReply>,
			) => void
		>(),
	removeHandler: vi.fn(),
}));
vi.mock("electron", () => ({ ipcMain: electron }));

const request = {
	connectionId: "connection",
	requestId: "request-1",
	text: "hello",
};
const scope = { connectionId: "connection", sessionId: "request-1" };
const text = {
	_tag: "textDelta",
	textDelta: "answer",
	kind: "generation",
} as const;
const done = { _tag: "completed", sessionId: "provider-session" } as const;
function provider(
	kind: RuntimeKind,
	streamConversation: RuntimeProviderAdapter["streamConversation"],
): RuntimeProviderAdapter {
	return {
		kind,
		streamConversation,
		health: () =>
			Effect.succeed({ status: "ready", lifecycle: "externallyManaged" }),
		capabilities: () =>
			Effect.succeed({
				health: "supported",
				chat: "supported",
				listAgents: "unsupported",
				sessions: "unsupported",
				resources: "unsupported",
				models: "unsupported",
				toolEvents: "unverified",
				usage: "unverified",
			}),
		listAgents: () => Effect.fail(new RuntimeCapabilityUnsupported()),
	};
}
function runtime(
	adapter: RuntimeProviderAdapter,
	baseURL = "http://localhost:1",
	resolve?: () => ConversationResolution,
) {
	return ManagedRuntime.make(
		ConversationService.Default.pipe(
			Layer.provide(
				Layer.succeed(ConversationRuntimePort, {
					resolve: () =>
						Effect.sync(
							() =>
								resolve?.() ?? {
									connection: {
										id: "connection",
										name: "fixture",
										kind: adapter.kind,
										baseURL,
									},
									adapter,
								},
						),
				}),
			),
		),
	);
}
async function fixture(
	handler: (
		input: unknown,
		response: ServerResponse,
		request: IncomingMessage,
	) => void,
) {
	const server = createServer((incoming, response) => {
		const chunks: Buffer[] = [];
		incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
		incoming.on("end", () =>
			handler(JSON.parse(Buffer.concat(chunks).toString()), response, incoming),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("fixture bind failed");
	return {
		baseURL: `http://127.0.0.1:${address.port}`,
		close: async () => {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	};
}
/** Real scoped HTTP consumer for service-level fixtures; adapter protocol tests live in lanes2/3. */
function httpProvider(
	kind: RuntimeKind,
	token: string,
): RuntimeProviderAdapter {
	return provider(kind, (connection, input) =>
		Stream.unwrapScoped(
			Effect.gen(function* () {
				const abort = yield* Effect.acquireRelease(
					Effect.sync(() => new AbortController()),
					(controller) => Effect.sync(() => controller.abort()),
				);
				const response = yield* Effect.tryPromise({
					try: () =>
						fetch(connection.baseURL, {
							method: "POST",
							headers: { authorization: `Bearer ${token}` },
							body: JSON.stringify(input),
							signal: abort.signal,
						}),
					catch: (cause) => new RuntimeRequestFailed(cause),
				});
				if (response.status === 401)
					return yield* new RuntimeAuthenticationFailed(
						new Error("private-token"),
					);
				const body = response.body;
				if (!body) return yield* new RuntimeProtocolInvalid();
				return Stream.fromReadableStream({
					evaluate: () => body,
					onError: (cause) => new RuntimeRequestFailed(cause),
				}).pipe(
					Stream.decodeText(),
					Stream.splitLines,
					Stream.filter((line) => line.length > 0),
					Stream.mapEffect((line) =>
						Effect.try({
							try: () => JSON.parse(line) as unknown,
							catch: (cause) => new RuntimeProtocolInvalid(cause),
						}).pipe(
							Effect.flatMap((value) =>
								Schema.decodeUnknown(RuntimeConversationEvent)(value),
							),
							Effect.catchTag("ParseError", (cause) =>
								Effect.fail(new RuntimeProtocolInvalid(cause)),
							),
						),
					),
				);
			}),
		),
	);
}
const collect = (
	service: ConversationService,
	owner = "owner",
	input: unknown = request,
) =>
	service
		.stream(owner, input)
		.pipe(Stream.runCollect, Effect.map(Chunk.toReadonlyArray));

describe("conversation service actual consumers", () => {
	it.each(["openclaw", "hermes"] as const)(
		"streams real HTTP events, keeps %s session private and clears history",
		async (kind) => {
			const sent: RuntimeConversationRequest[] = [];
			const server = await fixture((input, response, incoming) => {
				expect(incoming.headers.authorization).toBe("Bearer fixture-token");
				sent.push(Schema.decodeUnknownSync(RuntimeConversationRequest)(input));
				response.end(
					`${[
						{
							_tag: "status",
							kind: "thinking",
							text: "Working",
							sessionId: "provider-session",
						},
						text,
						{
							_tag: "tool",
							tool: "search",
							toolCallId: "tool-1",
							phase: "running",
							label: "Searching",
						},
						{
							_tag: "usage",
							usage: {
								inputTokens: 2,
								outputTokens: 3,
								provenance: "reported",
							},
						},
						done,
					]
						.map((event) => JSON.stringify(event))
						.join("\n")}\n`,
				);
			});
			const app = runtime(httpProvider(kind, "fixture-token"), server.baseURL);
			try {
				const events = await app.runPromise(
					Effect.flatMap(ConversationService, (service) => collect(service)),
				);
				expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5]);
				expect(events.at(-1)).toMatchObject({
					type: "end",
					outcome: "completed",
				});
				expect(
					events
						.filter((event) => event.type === "provider")
						.map((event) => event.event._tag),
				).toEqual(["status", "textDelta", "tool", "usage", "completed"]);
				expect(sent[0]?.sessionId).toBeUndefined();
				expect(sent[0]?.agentId).toBeUndefined();
				await app.runPromise(
					Effect.flatMap(ConversationService, (service) =>
						collect(service, "owner", {
							...request,
							requestId: "request-2",
							sessionId: "request-1",
							text: "follow up",
						}),
					),
				);
				expect(sent[1]).toMatchObject({
					sessionId: "provider-session",
					messages: [
						{ role: "user", content: "hello" },
						{ role: "assistant", content: "answer" },
						{ role: "user", content: "follow up" },
					],
				});
				const history = await app.runPromise(
					ConversationService.history("owner", scope),
				);
				expect(history[0]?.turns.map((turn) => turn.answer)).toEqual([
					"answer",
					"answer",
				]);
				expect(JSON.stringify(history)).not.toContain("provider-session");
				expect(
					await app.runPromise(
						ConversationService.history("other-owner", scope),
					),
				).toEqual([]);
				await app.runPromise(ConversationService.clear("owner", scope));
				expect(
					await app.runPromise(ConversationService.history("owner", scope)),
				).toEqual([]);
			} finally {
				await app.dispose();
				await server.close();
			}
		},
	);
	it("cancels an actual blocked HTTP read and waits for network scope release", async () => {
		let connected!: () => void;
		const accepted = new Promise<void>((resolve) => {
			connected = resolve;
		});
		let closed!: () => void;
		const disconnected = new Promise<void>((resolve) => {
			closed = resolve;
		});
		const server = await fixture((_input, response) => {
			response.write(
				`${JSON.stringify({ _tag: "status", kind: "thinking", text: "waiting" })}\n`,
			);
			response.once("close", closed);
		});
		const app = runtime(
			httpProvider("hermes", "fixture-token"),
			server.baseURL,
		);
		const events: ConversationEvent[] = [];
		try {
			const fiber = app.runFork(
				Effect.flatMap(ConversationService, (service) =>
					service.stream("owner", request).pipe(
						Stream.runForEach((event) =>
							Effect.sync(() => {
								events.push(event);
								connected();
							}),
						),
					),
				),
			);
			await accepted;
			await app.runPromise(
				ConversationService.cancel("other-owner", request.requestId),
			);
			expect(events).toHaveLength(1);
			await app.runPromise(
				ConversationService.cancel("owner", request.requestId),
			);
			await disconnected;
			await app.runPromise(Fiber.join(fiber));
			expect(events.at(-1)).toMatchObject({
				type: "end",
				outcome: "cancelled",
			});
			expect(
				events.some(
					(event) =>
						event.type === "provider" && event.event._tag === "completed",
				),
			).toBe(false);
			expect(
				(await app.runPromise(ConversationService.history("owner", scope)))[0]
					?.turns[0]?.outcome,
			).toBe("cancelled");
		} finally {
			await app.dispose();
			await server.close();
		}
	});
	it("doesn't retry dispatched authentication errors or expose their cause", async () => {
		let calls = 0;
		const server = await fixture((_input, response) => {
			calls++;
			response.writeHead(401);
			response.end();
		});
		const app = runtime(
			httpProvider("openclaw", "fixture-token"),
			server.baseURL,
		);
		try {
			const first = await app.runPromise(
				Effect.flatMap(ConversationService, (service) => collect(service)),
			);
			expect(first.at(-1)).toMatchObject({
				outcome: "failed",
				errorCode: "AGENT.HTTP.AUTH.FAILED",
			});
			expect(JSON.stringify(first)).not.toContain("private-token");
			const replay = await app.runPromise(
				Effect.flatMap(ConversationService, (service) => collect(service)),
			);
			expect(replay.at(-1)).toMatchObject({
				outcome: "failed",
				errorCode: "AGENT.HTTP.REQUEST.FAILED",
			});
			expect(calls).toBe(1);
		} finally {
			await app.dispose();
			await server.close();
		}
	});
});

function eventSink() {
	const events: ConversationEvent[] = [];
	const waits = new Set<{ count: number; resolve: () => void }>();
	return {
		events,
		send: (_source: unknown, event: ConversationEvent) => {
			events.push(event);
			for (const wait of waits)
				if (events.length >= wait.count) {
					waits.delete(wait);
					wait.resolve();
				}
			return true;
		},
		wait: (count: number): Promise<void> =>
			events.length >= count
				? Promise.resolve()
				: new Promise((resolve) => {
						waits.add({ count, resolve });
					}),
	};
}
const authority = {
	senderId: 7,
	frameURL: "file:///app/management.html#agents",
	mainFrame: true,
};
const renderer = "file:///app/management.html";
class FixtureWebContents extends EventEmitter {
	readonly id = 7;
	readonly mainFrame = { url: renderer };
	readonly isDestroyed = () => false;
	readonly getURL = () => renderer;
	readonly send = vi.fn<(channel: string, event: ConversationEvent) => void>();
}
it("actual registration stays offline and navigation aborts its provider before disposal", async () => {
	const { registerAgentConversations } = await import(
		"./conversation-registration.js"
	);
	let resolveCalls = 0;
	let released!: () => void;
	const release = new Promise<void>((resolve) => {
		released = resolve;
	});
	let delivered!: () => void;
	const delivery = new Promise<void>((resolve) => {
		delivered = resolve;
	});
	const webContents = new FixtureWebContents();
	webContents.send.mockImplementation(() => delivered());
	const adapter = provider("hermes", () =>
		Stream.unwrapScoped(
			Effect.acquireRelease(
				Effect.succeed(Stream.concat(Stream.make(text), Stream.never)),
				() => Effect.sync(released),
			),
		),
	);
	const registration = registerAgentConversations({
		management: () => ({ webContents, isDestroyed: () => false }),
		renderer,
		resolve: () => {
			resolveCalls++;
			return Effect.succeed({
				connection: {
					id: "connection",
					kind: "hermes",
					name: "fixture",
					baseURL: "http://localhost:1",
				},
				adapter,
			});
		},
	});
	try {
		expect(resolveCalls).toBe(0);
		const handler = electron.handle.mock.calls.find(
			([channel]) => channel === AGENT_CONVERSATIONS_REQUEST,
		)?.[1];
		expect(handler).toBeDefined();
		if (!handler) throw new Error("registration handler missing");
		expect(
			await handler(
				{ sender: webContents, senderFrame: { url: renderer } },
				{ type: "start", ...request },
			),
		).toMatchObject({ code: "AGENT.HTTP.IPC.UNAUTHORIZED" });
		expect(resolveCalls).toBe(0);
		await handler(
			{ sender: webContents, senderFrame: webContents.mainFrame },
			{ type: "start", ...request },
		);
		await delivery;
		webContents.emit("did-start-navigation");
		await release;
		await registration.dispose();
		expect(electron.removeHandler).toHaveBeenCalledWith(
			AGENT_CONVERSATIONS_REQUEST,
		);
		expect(webContents.listenerCount("did-start-navigation")).toBe(0);
		expect(webContents.listenerCount("destroyed")).toBe(0);
		expect(webContents.send).toHaveBeenCalledTimes(1);
	} finally {
		await registration.dispose();
	}
});
describe("conversation IPC controller", () => {
	it("authorizes main-frame management identity before parsing or provider dispatch", async () => {
		let resolved = 0;
		const adapter = provider("hermes", () => Stream.make(done));
		const app = runtime(adapter, undefined, () => {
			resolved++;
			return {
				connection: {
					id: "connection",
					name: "test",
					kind: "hermes",
					baseURL: "http://localhost:1",
				},
				adapter,
			};
		});
		const sink = eventSink();
		const controller = createConversationController({
			runtime: app,
			managementId: () => 7,
			renderer,
			send: sink.send,
		});
		try {
			for (const source of [
				{ ...authority, senderId: 8 },
				{ ...authority, mainFrame: false },
				{ ...authority, frameURL: "file:///app/strip.html" },
				{
					...authority,
					frameURL: "https://untrusted.test/app/management.html",
				},
			]) {
				expect(
					await controller.handle(source, { type: "start", ...request }),
				).toMatchObject({ code: "AGENT.HTTP.IPC.UNAUTHORIZED" });
			}
			expect(
				await controller.handle(authority, {
					type: "start",
					...request,
					credential: "private",
				}),
			).toMatchObject({ code: "AGENT.HTTP.CONNECTION.INVALID" });
			expect(resolved).toBe(0);
		} finally {
			await controller.dispose();
			await app.dispose();
		}
	});
	it("acknowledges exact sequences and limits delivery to one outstanding event", async () => {
		const app = runtime(provider("hermes", () => Stream.make(text, done)));
		const sink = eventSink();
		const controller = createConversationController({
			runtime: app,
			managementId: () => 7,
			renderer,
			send: sink.send,
		});
		try {
			expect(
				await controller.handle(authority, { type: "start", ...request }),
			).toMatchObject({ _tag: "success", sessionId: "request-1" });
			await sink.wait(1);
			expect(sink.events).toHaveLength(1);
			await controller.handle(authority, {
				type: "ack",
				requestId: request.requestId,
				seq: 99,
			});
			expect(sink.events).toHaveLength(1);
			await controller.handle(authority, {
				type: "ack",
				requestId: request.requestId,
				seq: 0,
			});
			await sink.wait(2);
			expect(sink.events).toHaveLength(2);
			await controller.handle(authority, {
				type: "ack",
				requestId: request.requestId,
				seq: 1,
			});
			await sink.wait(3);
			expect(sink.events[2]).toMatchObject({
				type: "end",
				outcome: "completed",
				seq: 2,
			});
			expect(
				await controller.handle(authority, { type: "history", ...scope }),
			).toMatchObject({ history: [{ turns: [{ outcome: "completed" }] }] });
			await controller.handle(authority, {
				type: "ack",
				requestId: request.requestId,
				seq: 2,
			});
			await controller.handle(authority, { type: "unsubscribe" });
			const history = await controller.handle(authority, {
				type: "history",
				...scope,
			});
			expect(history).toMatchObject({
				_tag: "success",
				history: [{ turns: [{ answer: "answer", outcome: "completed" }] }],
			});
			expect(
				await controller.handle(authority, { type: "clear", ...scope }),
			).toEqual({ _tag: "success", history: [] });
		} finally {
			await controller.dispose();
			await app.dispose();
		}
	});
	it.each(["cancel", "unsubscribe", "dispose"] as const)(
		"%s interrupts a consumer stalled on acknowledgement and releases actual HTTP",
		async (action) => {
			let closed!: () => void;
			const disconnected = new Promise<void>((resolve) => {
				closed = resolve;
			});
			const server = await fixture((_input, response) => {
				response.write(`${JSON.stringify(text)}\n`);
				response.once("close", closed);
			});
			const app = runtime(
				httpProvider("hermes", "fixture-token"),
				server.baseURL,
			);
			const sink = eventSink();
			const controller = createConversationController({
				runtime: app,
				managementId: () => 7,
				renderer,
				send: sink.send,
			});
			try {
				await controller.handle(authority, { type: "start", ...request });
				await sink.wait(1);
				if (action === "dispose") await controller.dispose();
				else
					await controller.handle(
						authority,
						action === "cancel"
							? { type: "cancel", requestId: request.requestId }
							: { type: "unsubscribe" },
					);
				await disconnected;
				expect(sink.events).toHaveLength(1);
				const histories = await app.runPromise(
					ConversationService.history("management:7", scope),
				);
				expect(histories[0]?.turns[0]?.outcome).toBe("cancelled");
			} finally {
				await controller.dispose();
				await app.dispose();
				await server.close();
			}
		},
	);
	it("times out an unacknowledged event, closes provider scope and exposes only its stable error", async () => {
		let released = false;
		const app = runtime(
			provider("hermes", () =>
				Stream.unwrapScoped(
					Effect.acquireRelease(
						Effect.succeed(Stream.concat(Stream.make(text), Stream.never)),
						() =>
							Effect.sync(() => {
								released = true;
							}),
					),
				),
			),
		);
		const sink = eventSink();
		const controller = createConversationController({
			runtime: app,
			managementId: () => 7,
			renderer,
			send: sink.send,
			acknowledgementTimeoutMs: 10,
		});
		try {
			await controller.handle(authority, { type: "start", ...request });
			await sink.wait(2);
			expect(released).toBe(true);
			expect(sink.events[1]).toMatchObject({
				type: "end",
				outcome: "failed",
				errorCode: "AGENT.HTTP.REQUEST.TIMEOUT",
			});
		} finally {
			await controller.dispose();
			await app.dispose();
		}
	});
	it("stops old window streams after navigation or management replacement", async () => {
		let managementId = 7;
		let released = false;
		const app = runtime(
			provider("hermes", () =>
				Stream.unwrapScoped(
					Effect.acquireRelease(Effect.succeed(Stream.make(text, done)), () =>
						Effect.sync(() => {
							released = true;
						}),
					),
				),
			),
		);
		const sink = eventSink();
		const controller = createConversationController({
			runtime: app,
			managementId: () => managementId,
			renderer,
			send: sink.send,
		});
		try {
			await controller.handle(authority, { type: "start", ...request });
			await sink.wait(1);
			managementId = 8;
			await controller.cancelOwner(7);
			expect(released).toBe(true);
			expect(sink.events).toHaveLength(1);
			expect(
				await controller.handle(authority, {
					type: "ack",
					requestId: request.requestId,
					seq: 0,
				}),
			).toMatchObject({ code: "AGENT.HTTP.IPC.UNAUTHORIZED" });
		} finally {
			await controller.dispose();
			await app.dispose();
		}
	});
});
