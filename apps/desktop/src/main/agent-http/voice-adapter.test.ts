import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
	ConversationRuntimePort,
	ConversationService,
} from "../../../../../packages/edge/src/agent-http/conversation-service.js";
import type {
	RuntimeConversationEvent,
	RuntimeConversationRequest,
} from "../../../../../packages/edge/src/agent-http/runtime-contracts.js";
import { RuntimeAuthenticationFailed } from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import type { RuntimeProviderAdapter } from "../../../../../packages/edge/src/agent-http/runtime-ports.js";
import {
	GridVoice,
	GridVoiceRuntime,
	type VoiceSurface,
} from "../../../../../packages/edge/src/voice/surface/index.js";
import type { AgentConnectionSelection } from "../../shared/agent-connections";
import type { VoiceSurfaceEvent } from "../../shared/voice-surface";
import { voiceSurfaceLayer } from "../voice";
import { createAgentConnectionsBridge } from "./connection-preload";
import { registerAgentHttp } from "./index";
import { createAgentHttpVoiceAdapter } from "./voice-adapter";

const ipc = vi.hoisted(() => ({
	handlers: new Map<
		string,
		(event: unknown, input: unknown) => Promise<unknown>
	>(),
}));
vi.mock("electron", () => ({
	BrowserWindow: {},
	clipboard: {},
	dialog: {},
	ipcMain: {
		handle: (
			channel: string,
			handler: (event: unknown, input: unknown) => Promise<unknown>,
		) => ipc.handlers.set(channel, handler),
		removeHandler: (channel: string) => ipc.handlers.delete(channel),
	},
	shell: {},
	app: {},
	safeStorage: {
		isEncryptionAvailable: () => true,
		getSelectedStorageBackend: () => "fixture",
		encryptString: (value: string) => Buffer.from(value),
		decryptString: (value: Buffer) => value.toString(),
	},
}));

const connection = {
	id: "hermes-local",
	name: "Hermes",
	kind: "hermes" as const,
	baseURL: "http://localhost:8642/",
};
const request = {
	serial: "mock-quake",
	keyCode: "1,5",
	agentId: "local-workspace-agent",
	message: "hello",
};
const answer = (text = "answer"): Stream.Stream<RuntimeConversationEvent> =>
	Stream.fromIterable([
		{ _tag: "textDelta", textDelta: text, kind: "generation" },
		{ _tag: "completed", sessionId: "remote-session" },
	]);

async function setup(
	provider: RuntimeProviderAdapter["streamConversation"] = () => answer(),
) {
	const stream = vi.fn(provider);
	const adapter: RuntimeProviderAdapter = {
		kind: "hermes",
		health: vi.fn(() =>
			Effect.succeed({
				status: "ready" as const,
				lifecycle: "externallyManaged" as const,
			}),
		),
		capabilities: vi.fn(() =>
			Effect.succeed({
				health: "supported" as const,
				chat: "supported" as const,
				listAgents: "unsupported" as const,
				sessions: "unsupported" as const,
				resources: "unsupported" as const,
				models: "unsupported" as const,
				toolEvents: "unverified" as const,
				usage: "unverified" as const,
			}),
		),
		listAgents: vi.fn(() => Effect.succeed([])),
		streamConversation: stream,
	};
	const conversations = ManagedRuntime.make(
		ConversationService.Default.pipe(
			Layer.provide(
				Layer.succeed(ConversationRuntimePort, {
					resolve: () => Effect.succeed({ connection, adapter }),
				}),
			),
		),
	);
	const service = await conversations.runPromise(ConversationService);
	let selected: AgentConnectionSelection | undefined = {
		connectionId: connection.id,
	};
	let generation = 0;
	let selectionWait = Promise.resolve();
	let voice:
		| Effect.Effect.Success<ReturnType<typeof createAgentHttpVoiceAdapter>>
		| undefined;
	const events: VoiceSurfaceEvent[] = [];
	const fallback = GridVoiceRuntime.of({
		select: vi.fn(() => Effect.void),
		startCapture: vi.fn(() => Effect.void),
		releaseCapture: vi.fn(() => Effect.void),
		cancelCapture: vi.fn(() => Effect.void),
		cancelFlow: vi.fn(() => Effect.void),
		sendText: vi.fn(() => Effect.void),
	});
	const runtime = ManagedRuntime.make(
		voiceSurfaceLayer(
			{
				mock: true,
				tones: { play: () => {} },
				runtime: () =>
					Layer.scoped(
						GridVoiceRuntime,
						Effect.gen(function* () {
							voice = yield* createAgentHttpVoiceAdapter(
								{
									selected: () =>
										Effect.promise(() => selectionWait).pipe(
											Effect.zipRight(Effect.sync(() => selected)),
										),
									stream: service.stream,
									cancel: service.cancel,
									generation: () => generation,
								},
								fallback,
							);
							return voice.runtime;
						}),
					),
			},
			(event) => events.push(event),
		),
	);
	await runtime.runPromise(GridVoice);
	return {
		runtime,
		stream,
		events,
		fallback,
		adapter,
		service,
		waitSelection: (wait: Promise<void>) => {
			selectionWait = wait;
		},
		sendTranscript: (input: typeof request) => {
			if (!voice) throw new Error("Voice adapter not initialized");
			return runtime.runPromise(voice.sendTranscript(input));
		},
		select: (value: AgentConnectionSelection | undefined) => {
			generation++;
			selected = value;
		},
		dispose: async () => {
			await runtime.dispose();
			await conversations.dispose();
		},
	};
}

const terminals = (events: readonly VoiceSurfaceEvent[]) =>
	events.flatMap((event) =>
		event._tag === "Chunk" && event.chunk.type === "end" ? [event.chunk] : [],
	);

describe("HTTP conversations through the production GridVoice consumer", () => {
	it("routes a normalized transcript through the same session and answer display", async () => {
		const fixture = await setup();
		try {
			await fixture.sendTranscript(request);
			await vi.waitFor(() => expect(terminals(fixture.events)).toHaveLength(1));
			expect(
				fixture.events.find((event) => event._tag === "TurnStarted"),
			).toMatchObject({ source: "voice", prompt: "hello" });
			expect(fixture.fallback.startCapture).not.toHaveBeenCalled();
		} finally {
			await fixture.dispose();
		}
	});

	it("allows cancellation while a new send waits for a connection transition", async () => {
		let aborted = 0;
		const fixture = await setup((_connection, input) =>
			input.messages.at(-1)?.content === "hello"
				? Stream.never.pipe(
						Stream.ensuring(
							Effect.sync(() => {
								aborted++;
							}),
						),
					)
				: answer("new"),
		);
		let release = () => {};
		const paused = new Promise<void>((resolve) => {
			release = resolve;
		});
		try {
			await fixture.runtime.runPromise(GridVoice.sendText(request));
			await vi.waitFor(() => expect(fixture.stream).toHaveBeenCalledOnce());
			fixture.waitSelection(paused);
			const pending = fixture.runtime.runPromise(
				GridVoice.sendText({ ...request, message: "new" }),
			);
			await fixture.runtime.runPromise(
				GridVoice.reset(request.serial, "profileChanged"),
			);
			expect(aborted).toBe(1);
			release();
			await pending;
			await vi.waitFor(() => expect(terminals(fixture.events)).toHaveLength(2));
		} finally {
			release();
			await fixture.dispose();
		}
	});
	it("composes the actual bridge, secure credential resolver, Hermes HTTP adapter and strip answer consumer", async () => {
		const scratch =
			"/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-agent-http/lane-9";
		await mkdir(scratch, { recursive: true });
		const root = await mkdtemp(join(scratch, "composition-"));
		const calls: { path: string; authenticated: boolean; session?: string }[] =
			[];
		const server = createServer((input, response) => {
			calls.push({
				path: input.url ?? "",
				authenticated:
					input.headers.authorization === "Bearer fixture-credential",
				...(typeof input.headers["x-hermes-session-id"] === "string"
					? { session: input.headers["x-hermes-session-id"] }
					: {}),
			});
			if (input.url === "/gateway/v1/chat/completions") {
				response.writeHead(200, {
					"Content-Type": "text/event-stream",
					"X-Hermes-Session-Id": "actual-remote-session",
				});
				response.end(
					`data: ${JSON.stringify({ object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "from production HTTP" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
				);
				return;
			}
			response.setHeader("Content-Type", "application/json");
			if (input.url === "/gateway/v1/capabilities")
				response.end(
					JSON.stringify({
						object: "hermes.api_server.capabilities",
						platform: "hermes-agent",
						model: "hermes-agent",
						features: {
							chat_completions: true,
							chat_completions_streaming: true,
							tool_progress_events: false,
						},
					}),
				);
			else if (input.url === "/gateway/v1/models")
				response.end(
					JSON.stringify({
						object: "list",
						data: [{ id: "hermes-agent", object: "model" }],
					}),
				);
			else {
				response.statusCode = 404;
				response.end("{}");
			}
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Fixture port unavailable");
		const frame = {};
		const window = {
			isDestroyed: () => false,
			webContents: {
				id: 901,
				isDestroyed: () => false,
				getURL: () => "file:///app/renderer/index.html?surface=management",
				send: vi.fn(),
				mainFrame: frame,
			},
		};
		const bridge = createAgentConnectionsBridge({
			invoke: async (channel, command) => {
				const handler = ipc.handlers.get(channel);
				if (!handler) throw new Error("Production handler unavailable");
				return handler(
					{
						sender: window.webContents,
						senderFrame: frame,
					},
					command,
				);
			},
			on: () => {},
			off: () => {},
		});
		// IPC authority compares frame identity, as Electron does.
		Object.assign(frame, { url: window.webContents.getURL() });
		const events: VoiceSurfaceEvent[] = [];
		const reset = vi.fn(async () => undefined);
		let registration: Awaited<ReturnType<typeof registerAgentHttp>> | undefined;
		let runtime:
			| ManagedRuntime.ManagedRuntime<GridVoice | VoiceSurface, never>
			| undefined;
		try {
			registration = await registerAgentHttp({
				root,
				management: () => window as unknown as BrowserWindow,
				renderer: "file:///app/renderer/index.html",
				invalidated: reset,
				publish: async (event) => {
					events.push(event);
				},
			});
			expect(calls).toHaveLength(0);
			const saved = await bridge.request({
				type: "save",
				name: "Fixture Hermes",
				kind: "hermes",
				baseURL: `http://127.0.0.1:${address.port}/gateway/`,
				credential: "fixture-credential",
			});
			expect(saved._tag).toBe("success");
			if (saved._tag !== "success")
				throw new Error("Fixture connection rejected");
			const id = saved.view.connections[0]?.id;
			if (!id) throw new Error("Fixture connection missing");
			expect(JSON.stringify(saved)).not.toContain("fixture-credential");
			expect(JSON.stringify(saved)).not.toContain("credentialRef");
			expect(await bridge.request({ type: "select", id })).toMatchObject({
				_tag: "success",
				view: { selected: { connectionId: id } },
			});
			await vi.waitFor(() => expect(reset).toHaveBeenCalledTimes(2));
			expect(calls).toHaveLength(0);
			const discovery = await bridge.request({ type: "discover", id });
			expect(discovery).toMatchObject({
				_tag: "success",
				discovery: {
					agents: [],
					capabilities: { chat: "supported", listAgents: "unsupported" },
				},
			});
			runtime = ManagedRuntime.make(
				voiceSurfaceLayer(
					{
						mock: true,
						tones: { play: () => {} },
						runtime: registration.decorateVoiceRuntime,
					},
					(event) => events.push(event),
				),
			);
			await runtime.runPromise(GridVoice.sendText(request));
			await vi.waitFor(() => expect(terminals(events)).toHaveLength(1));
			expect(terminals(events)[0]?.outcome).toBe("completed");
			expect(
				events.find(
					(event) => event._tag === "Chunk" && event.chunk.type === "answer",
				),
			).toMatchObject({ chunk: { textDelta: "from production HTTP" } });
			await runtime.runPromise(
				GridVoice.sendText({ ...request, message: "second" }),
			);
			await vi.waitFor(() => expect(terminals(events)).toHaveLength(2));
			expect(
				calls.filter((call) => call.path.endsWith("/chat/completions")),
			).toMatchObject([
				{ authenticated: true },
				{ authenticated: true, session: "actual-remote-session" },
			]);
			expect(calls.every((call) => call.authenticated)).toBe(true);
		} finally {
			await runtime?.dispose();
			await registration?.dispose();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
			await rm(root, { recursive: true, force: true });
		}
	});
	it("stays offline until an explicit send, uses Hermes default and retains real remote session continuity", async () => {
		const fixture = await setup();
		try {
			expect(fixture.stream).not.toHaveBeenCalled();
			expect(fixture.adapter.health).not.toHaveBeenCalled();
			await fixture.runtime.runPromise(GridVoice.sendText(request));
			await vi.waitFor(() => expect(terminals(fixture.events)).toHaveLength(1));
			expect(fixture.fallback.sendText).not.toHaveBeenCalled();
			const outbound = fixture.stream.mock.calls[0]?.[1];
			expect(outbound).toMatchObject({
				connectionId: connection.id,
				messages: [{ role: "user", content: "hello" }],
			});
			expect(outbound).not.toHaveProperty("agentId");
			expect(outbound).not.toHaveProperty("sessionId");
			expect(
				fixture.events.filter((event) => event._tag === "Tool"),
			).toHaveLength(0);
			expect(
				fixture.events.find(
					(event) => event._tag === "Chunk" && event.chunk.type === "answer",
				),
			).toMatchObject({ chunk: { textDelta: "answer" } });
			await fixture.runtime.runPromise(
				GridVoice.sendText({ ...request, message: "again" }),
			);
			await vi.waitFor(() => expect(terminals(fixture.events)).toHaveLength(2));
			expect(fixture.stream.mock.calls[1]?.[1]).toMatchObject({
				sessionId: "remote-session",
				messages: [
					{ role: "user", content: "hello" },
					{ role: "assistant", content: "answer" },
					{ role: "user", content: "again" },
				],
			});
		} finally {
			await fixture.dispose();
		}
	});

	it("routes only the explicitly selected provider agent, independent of local workspace IDs", async () => {
		const fixture = await setup();
		try {
			fixture.select({ connectionId: connection.id, agentId: "remote-writer" });
			await fixture.runtime.runPromise(GridVoice.sendText(request));
			await vi.waitFor(() => expect(terminals(fixture.events)).toHaveLength(1));
			expect(fixture.stream.mock.calls[0]?.[1].agentId).toBe("remote-writer");
			expect(
				fixture.events.find((event) => event._tag === "TurnStarted"),
			).toMatchObject({ agent: { id: "remote-writer" } });
		} finally {
			await fixture.dispose();
		}
	});

	it("preserves existing typed and capture behavior with no external selection", async () => {
		const fixture = await setup();
		try {
			fixture.select(undefined);
			await fixture.runtime.runPromise(GridVoice.sendText(request));
			await fixture.runtime.runPromise(
				GridVoice.knob(request.serial, "holdStart", 1),
			);
			expect(fixture.fallback.sendText).toHaveBeenCalledWith(request);
			expect(fixture.fallback.startCapture).toHaveBeenCalledWith(
				expect.objectContaining({ type: "knob" }),
			);
			expect(fixture.stream).not.toHaveBeenCalled();
		} finally {
			await fixture.dispose();
		}
	});

	it("displays only actual tool progress and exactly one completion", async () => {
		const fixture = await setup(() =>
			Stream.fromIterable<RuntimeConversationEvent>([
				{
					_tag: "tool",
					toolCallId: "tool-1",
					tool: "read_file",
					phase: "running",
					arguments: "README.md",
				},
				{
					_tag: "tool",
					toolCallId: "tool-1",
					tool: "read_file",
					phase: "completed",
				},
				{ _tag: "textDelta", textDelta: "read", kind: "generation" },
				{ _tag: "completed" },
			]),
		);
		try {
			await fixture.runtime.runPromise(GridVoice.sendText(request));
			await vi.waitFor(() => expect(terminals(fixture.events)).toHaveLength(1));
			expect(
				fixture.events.filter((event) => event._tag === "Tool"),
			).toMatchObject([
				{ phase: "start", name: "read_file", args: "README.md" },
				{ phase: "result", name: "read_file" },
			]);
			expect(terminals(fixture.events)[0]?.outcome).toBe("completed");
		} finally {
			await fixture.dispose();
		}
	});

	it("cancels a processing turn on a device reset and physically finalizes consumption", async () => {
		let aborted = 0;
		const fixture = await setup(() =>
			Stream.concat(
				Stream.fromIterable<RuntimeConversationEvent>([
					{
						_tag: "textDelta",
						kind: "generation",
						textDelta: "partial",
					},
				]),
				Stream.never,
			).pipe(
				Stream.ensuring(
					Effect.sync(() => {
						aborted++;
					}),
				),
			),
		);
		try {
			await fixture.runtime.runPromise(GridVoice.sendText(request));
			await vi.waitFor(() => expect(fixture.stream).toHaveBeenCalledOnce());
			await fixture.runtime.runPromise(
				GridVoice.reset(request.serial, "disconnected"),
			);
			expect(aborted).toBe(1);
			expect(terminals(fixture.events)).toMatchObject([
				{ outcome: "cancelled" },
			]);
			expect(fixture.events.at(-1)).toMatchObject({
				_tag: "Reset",
				reason: "disconnected",
			});
		} finally {
			await fixture.dispose();
		}
	});

	it("supersedes the previous turn before routing another send", async () => {
		let aborted = 0;
		const fixture = await setup(
			(_connection, input: RuntimeConversationRequest) =>
				input.messages.at(-1)?.content === "hello"
					? Stream.never.pipe(
							Stream.ensuring(
								Effect.sync(() => {
									aborted++;
								}),
							),
						)
					: answer("second"),
		);
		try {
			await fixture.runtime.runPromise(GridVoice.sendText(request));
			await vi.waitFor(() => expect(fixture.stream).toHaveBeenCalledOnce());
			await fixture.runtime.runPromise(
				GridVoice.sendText({ ...request, message: "second" }),
			);
			await vi.waitFor(() => expect(terminals(fixture.events)).toHaveLength(2));
			expect(aborted).toBe(1);
			expect(terminals(fixture.events).map((event) => event.outcome)).toEqual([
				"cancelled",
				"completed",
			]);
		} finally {
			await fixture.dispose();
		}
	});

	it("projects a canonical provider failure without exposing raw details", async () => {
		const fixture = await setup(() =>
			Stream.fail(
				new RuntimeAuthenticationFailed(
					new Error("secret-token private prompt"),
				),
			),
		);
		try {
			await fixture.runtime.runPromise(GridVoice.sendText(request));
			await vi.waitFor(() => expect(terminals(fixture.events)).toHaveLength(1));
			expect(terminals(fixture.events)).toMatchObject([
				{ outcome: "failed", errorCode: "AGENT.HTTP.AUTH.FAILED" },
			]);
			expect(JSON.stringify(fixture.events)).not.toContain("secret-token");
		} finally {
			await fixture.dispose();
		}
	});

	it("keeps microphone capture on the original runtime even with an HTTP selection", async () => {
		const fixture = await setup();
		try {
			await fixture.runtime.runPromise(
				GridVoice.knob(request.serial, "holdStart", 2),
			);
			expect(fixture.fallback.startCapture).toHaveBeenCalledOnce();
			expect(fixture.stream).not.toHaveBeenCalled();
		} finally {
			await fixture.dispose();
		}
	});

	it("disposes active external consumption without launching or stopping a server", async () => {
		let aborted = 0;
		const fixture = await setup(() =>
			Stream.never.pipe(
				Stream.ensuring(
					Effect.sync(() => {
						aborted++;
					}),
				),
			),
		);
		await fixture.runtime.runPromise(GridVoice.sendText(request));
		await vi.waitFor(() => expect(fixture.stream).toHaveBeenCalledOnce());
		await fixture.dispose();
		expect(aborted).toBe(1);
	});
});
