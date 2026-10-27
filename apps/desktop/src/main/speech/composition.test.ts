import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	Deferred,
	Effect,
	Layer,
	Option,
	Queue,
	Redacted,
	Stream,
} from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAssistantSettings } from "../../../../../packages/device/src/profiles/assistant-contracts";
import {
	ConversationRuntimePort,
	ConversationService,
} from "../../../../../packages/edge/src/agent-http/conversation-service";
import type { RuntimeConversationRequest } from "../../../../../packages/edge/src/agent-http/runtime-contracts";
import type { RuntimeProviderAdapter } from "../../../../../packages/edge/src/agent-http/runtime-ports";
import {
	SpeechHttp,
	SpeechOutput,
	SpeechWebSocket,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { wav } from "../../../../../packages/edge/src/ai/speech/speech-test-fixtures";
import {
	GridVoiceRuntime,
	VoiceRuntimeUnavailable,
} from "../../../../../packages/edge/src/voice/surface";
import type { VoiceSurfaceEvent } from "../../shared/voice-surface";
import { createAgentHttpVoiceAdapter } from "../agent-http/voice-adapter";
import { createDirectChat } from "../chat/host";
import { assistantCapturePreparer, createDirectChatVoice } from "../chat/voice";
import { createDesktopDiagnostics } from "../diagnostics";
import { makeDesktopRuntime } from "../diagnostics/runtime";
import { voiceSurfaceLayer } from "../voice";
import type { CaptureSession } from "./capture";
import { createSpeechVoiceBinding } from "./composition";
import { emptySpeechSettings } from "./settings";

vi.mock("electron", () => ({
	app: {},
	BrowserWindow: {},
	session: {},
	systemPreferences: {},
	ipcMain: {},
	shell: {},
	clipboard: {},
	dialog: {},
}));
const connection = {
	id: "external",
	name: "Fixture",
	kind: "hermes" as const,
	baseURL: "http://localhost:8642/",
};
const request = {
	serial: "quake",
	keyCode: "1,5",
	agentId: "local-uuid-must-not-route",
	message: "private typed input",
};

async function fixture(
	directory: string,
	selected = true,
	permission = true,
	directRoute = false,
	assistant = false,
	localModel = true,
) {
	const diagnostics = createDesktopDiagnostics({ directory });
	const background = makeDesktopRuntime(Layer.empty, diagnostics);
	const events: VoiceSurfaceEvent[] = [];
	const requests: RuntimeConversationRequest[] = [];
	const old = vi.fn(() => Effect.void);
	const directRequests: { messages: { role: string; content: string }[] }[] =
		[];
	let generation = 0;
	let connected = true;
	let voiceEnabled = true;
	let delayPreparation = false;
	let preparationStarted = false;
	const pinExternal = () =>
		Effect.suspend(() => {
			preparationStarted = true;
			if (delayPreparation) return Effect.never;
			return !selected
				? Effect.succeed(undefined)
				: connected
					? Effect.succeed({
							connectionId: connection.id,
							generation,
							registryGeneration: generation,
						})
					: Effect.fail(new VoiceRuntimeUnavailable());
		});
	const directChat =
		directRoute || assistant
			? createDirectChat({
					directory: join(directory, "chat"),
					diagnostics,
					credentials: {
						resolve: () => Effect.succeed(Redacted.make("private-model-key")),
						revoked: () => Effect.never,
					},
					keySettings: () =>
						Effect.sync(() =>
							assistant
								? {
										...defaultAssistantSettings(),
										useAgent: false,
										enableVoiceInput: voiceEnabled,
									}
								: undefined,
						),
					online: () => true,
					models: () =>
						Effect.succeed(
							localModel
								? [
										{
											id: "model",
											role: "default",
											provider: "generic",
											model: "synthetic",
											baseUrl: "http://localhost:8642/v1",
											credentialRef: "00000000-0000-4000-8000-000000000001",
											maxTokens: 1024,
										},
									]
								: [],
						),
					fetch: async (_url, init) => {
						directRequests.push(JSON.parse(String(init?.body)));
						return new Response(
							'data: {"choices":[{"index":0,"delta":{"content":"Private direct spoken reply."},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
							{ headers: { "content-type": "text/event-stream" } },
						);
					},
				})
			: undefined;
	let closed = 0;
	const stopped = await Effect.runPromise(Deferred.make<void>());
	const messages = await Effect.runPromise(Queue.unbounded<unknown>());
	const played = await Effect.runPromise(Deferred.make<void>());
	const drain = await Effect.runPromise(Deferred.make<void>());
	const adapter: RuntimeProviderAdapter = {
		kind: "hermes",
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
		listAgents: () => Effect.succeed([]),
		streamConversation: (_connection, input) => {
			requests.push(input);
			return Stream.fromIterable([
				{
					_tag: "textDelta",
					textDelta: "Private spoken reply.",
					kind: "generation",
				},
				{ _tag: "completed", sessionId: "provider-session" },
			]);
		},
	};
	const conversations = makeDesktopRuntime(
		ConversationService.Default.pipe(
			Layer.provide(
				Layer.succeed(ConversationRuntimePort, {
					resolve: () => Effect.succeed({ connection, adapter }),
				}),
			),
		),
		diagnostics,
	);
	const service = await conversations.runPromise(ConversationService);
	const keys = new Map<string, string>();
	let stored: unknown = emptySpeechSettings;
	let pulled = false;
	const binding = createSpeechVoiceBinding({
		run: (effect) => background.runPromise(effect),
		...(directChat
			? {
					direct: (fallback: typeof GridVoiceRuntime.Service) =>
						createDirectChatVoice(directChat, fallback),
				}
			: {}),
		http: (fallback, fallbackTranscript) =>
			createAgentHttpVoiceAdapter(
				{
					selected: () =>
						Effect.succeed(
							selected ? { connectionId: connection.id } : undefined,
						),
					stream: service.stream,
					cancel: service.cancel,
					generation: () => generation,
					validateAssistantRoute: (route) =>
						Effect.succeed(
							connected && selected && route.generation === generation,
						),
				},
				fallback,
				fallbackTranscript,
			),
		speech: {
			...(assistant && directChat
				? {
						prepareAssistant: assistantCapturePreparer(directChat, pinExternal),
					}
				: {}),
			diagnostics,
			storage: {
				read: async () => stored,
				write: async (value) => {
					stored = value;
				},
			},
			credentials: {
				put: async (value) => {
					const id = crypto.randomUUID();
					keys.set(id, value);
					return id;
				},
				get: async (id) => keys.get(id) ?? "",
				remove: async (id) => {
					keys.delete(id);
				},
			},
			capture: {
				permission: Effect.succeed(permission),
				open: (id) =>
					Effect.succeed({
						pull: Effect.suspend<
							Effect.Effect.Success<CaptureSession["pull"]>,
							never,
							never
						>(() => {
							if (!pulled) {
								pulled = true;
								return Effect.succeed({
									frames: [
										{
											captureId: id,
											seq: 0,
											bytes: new Uint8Array(960),
											rms: 0.1,
											peak: 0.1,
										},
									],
									done: false,
								});
							}
							return Deferred.await(stopped).pipe(
								Effect.as({ frames: [], done: true }),
							);
						}),
						stop: Deferred.succeed(stopped, undefined).pipe(Effect.asVoid),
						close: Effect.sync(() => {
							closed++;
						}),
					}),
			},
			ports: Layer.mergeAll(
				Layer.succeed(SpeechHttp, {
					fetch: async () =>
						new Response(wav(), { headers: { "Content-Type": "audio/wav" } }),
				}),
				Layer.succeed(SpeechOutput, {
					suspendForCapture: Effect.void,
					acquire: Effect.succeed({
						ready: Effect.void,
						stop: Effect.void,
						play: () =>
							Deferred.succeed(played, undefined).pipe(
								Effect.zipRight(Deferred.await(drain)),
							),
					}),
				}),
				Layer.succeed(SpeechWebSocket, {
					connect: () =>
						Effect.succeed({
							receive: Queue.take(messages),
							close: Effect.void,
							send: (data) => {
								if (typeof data !== "string") return Effect.void;
								const command = JSON.parse(data) as {
									header: { action: string; task_id: string };
								};
								const event = (event: string, payload: unknown = {}) => ({
									header: { task_id: command.header.task_id, event },
									payload,
								});
								return Queue.offerAll(
									messages,
									command.header.action === "run-task"
										? [event("task-started")]
										: [
												event("result-generated", {
													output: {
														sentence: {
															text: "Private finalized transcript",
															begin_time: 0,
															sentence_end: true,
														},
													},
												}),
												event("task-finished"),
											],
								).pipe(Effect.asVoid);
							},
						}),
				}),
			),
		},
	});
	const fallback = Layer.succeed(GridVoiceRuntime, {
		select: () => Effect.void,
		startCapture: () => Effect.die("old capture path"),
		releaseCapture: () => Effect.void,
		cancelCapture: () => Effect.void,
		cancelFlow: () => Effect.void,
		sendText: old,
	});
	const voice = makeDesktopRuntime(
		voiceSurfaceLayer(
			{
				mock: true,
				tones: { play: () => {} },
				runtime: () => binding.decorate(fallback),
			},
			(event) => {
				events.push(event);
				binding.onEvent(event);
			},
		),
		diagnostics,
	);
	const runtime = await voice.runPromise(GridVoiceRuntime);
	await background.runPromise(
		binding.settings.request({
			_tag: "Save",
			settings: {
				version: 1,
				speakAnswers: true,
				stt: { workspace: "fixture", region: "cn-beijing" },
				tts: { provider: "openai", voice: "marin", language: "en" },
			},
			sttKey: "private-STT-key",
			ttsKey: "private-TTS-key",
		}),
	);
	return {
		binding,
		runtime,
		voice,
		background,
		events,
		requests,
		old,
		directRequests,
		drain,
		played,
		closed: () => closed,
		setSelected: (next: boolean) => {
			selected = next;
			generation++;
		},
		setConnected: (next: boolean) => {
			connected = next;
			generation++;
		},
		preparationStarted: () => preparationStarted,
		delayPreparation: (next: boolean) => {
			delayPreparation = next;
		},
		setVoice: (next: boolean) => {
			voiceEnabled = next;
		},
		async close() {
			await background.runPromise(Deferred.succeed(drain, undefined));
			await voice.dispose();
			await conversations.dispose();
			await directChat?.dispose();
			await background.dispose();
			await diagnostics.close();
		},
	};
}
const capture = {
	serial: request.serial,
	keyCode: request.keyCode,
	captureId: "capture-1",
	generation: 1,
	type: "aiChat" as const,
	agentId: Option.some(request.agentId),
};
const scratchDirectories = new Set<string>();
afterEach(async () => {
	await Promise.all(
		[...scratchDirectories].map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
	scratchDirectories.clear();
});
async function scratch() {
	const root =
		process.env.OPEN_QUAKE_TEST_SCRATCH ??
		join(homedir(), "dev/agentic-scratchpads/open-quake/tests");
	await import("node:fs/promises").then((fs) =>
		fs.mkdir(root, { recursive: true }),
	);
	const directory = await mkdtemp(join(root, "speech-binding-"));
	scratchDirectories.add(directory);
	return directory;
}

describe("actual root speech and HTTP binding", () => {
	it("finalizes synthetic capture into one selected runtime request and drains ordered answer audio without invoking the unavailable fallback", async () => {
		const directory = await scratch();
		const f = await fixture(directory);
		try {
			await f.voice.runPromise(f.runtime.startCapture(capture));
			await vi.waitFor(() =>
				expect(
					f.events.some(
						(e) =>
							e._tag === "Stage" &&
							e.stage._tag === "recording" &&
							e.stage.status === "listening",
					),
				).toBe(true),
			);
			await f.voice.runPromise(
				f.runtime.releaseCapture(capture.serial, capture.keyCode, 1),
			);
			await f.background.runPromise(Deferred.await(f.played));
			expect(f.requests).toHaveLength(1);
			expect(f.requests[0]?.messages.at(-1)?.content).toBe(
				"Private finalized transcript",
			);
			expect(f.requests[0]?.agentId).toBeUndefined();
			expect(f.closed()).toBe(1);
			expect(f.old).not.toHaveBeenCalled();
			expect(await f.background.runPromise(Deferred.isDone(f.drain))).toBe(
				false,
			);
			await f.background.runPromise(Deferred.succeed(f.drain, undefined));
		} finally {
			await f.close();
		}
		const logs = await readFile(
			join(directory, "diagnostics.0.ndjson"),
			"utf8",
		);
		expect(logs).toContain('"span_name":"speech.recognize"');
		expect(logs).toContain('"span_name":"speech.playback"');
		for (const privateValue of [
			"Private finalized transcript",
			"Private spoken reply",
			"private-STT-key",
			"private-TTS-key",
		])
			expect(logs).not.toContain(privateValue);
		await rm(directory, { recursive: true });
	}, 10000);
	it("keeps the original fallback once when no external runtime is selected", async () => {
		const directory = await scratch();
		const f = await fixture(directory, false);
		try {
			await f.voice.runPromise(f.runtime.sendText(request));
			expect(f.old).toHaveBeenCalledExactlyOnceWith(request);
			expect(f.requests).toHaveLength(0);
		} finally {
			await f.close();
			await rm(directory, { recursive: true });
		}
	});
	it("retains a permission failure trace and sends no transcript or inference request", async () => {
		const directory = await scratch();
		const f = await fixture(directory, true, false);
		try {
			await f.voice.runPromise(f.runtime.startCapture(capture));
			await vi.waitFor(() =>
				expect(
					f.events.some((e) => e._tag === "Stage" && e.stage._tag === "failed"),
				).toBe(true),
			);
			expect(f.requests).toHaveLength(0);
			expect(f.old).not.toHaveBeenCalled();
		} finally {
			await f.close();
		}
		const logs = await readFile(
			join(directory, "diagnostics.0.ndjson"),
			"utf8",
		);
		expect(logs).toContain("VOICE.CAPTURE.PERMISSION_DENIED");
		expect(logs).toContain('"outcome":"failure"');
		expect(logs).not.toContain("private-STT-key");
		await rm(directory, { recursive: true });
	});
	it("routes finalized capture through the actual direct ChatService and speech when the external runtime is deselected", async () => {
		const directory = await scratch();
		const f = await fixture(directory, false, true, true);
		try {
			await f.voice.runPromise(f.runtime.startCapture(capture));
			await vi.waitFor(() =>
				expect(
					f.events.some(
						(e) =>
							e._tag === "Stage" &&
							e.stage._tag === "recording" &&
							e.stage.status === "listening",
					),
				).toBe(true),
			);
			await f.voice.runPromise(
				f.runtime.releaseCapture(capture.serial, capture.keyCode, 1),
			);
			await f.background.runPromise(Deferred.await(f.played));
			expect(f.directRequests).toHaveLength(1);
			expect(f.directRequests[0]?.messages.at(-1)?.content).toBe(
				"Private finalized transcript",
			);
			expect(
				f.events.some(
					(event) => event._tag === "TurnStarted" && event.source === "voice",
				),
			).toBe(true);
			expect(
				f.events.some(
					(event) =>
						event._tag === "Chunk" &&
						event.chunk.type === "answer" &&
						event.chunk.textDelta === "Private direct spoken reply.",
				),
			).toBe(true);
			expect(f.old).not.toHaveBeenCalled();
			expect(f.requests).toHaveLength(0);
		} finally {
			await f.close();
			await rm(directory, { recursive: true });
		}
	}, 10000);
});

// Production capture owner + assistant preparer + direct/HTTP decorators. All IO is fake.
it("PR128 external assistant capture needs speech and voice readiness but no local model", async () => {
	const f = await fixture(await scratch(), true, true, false, true, false);
	try {
		await f.voice.runPromise(f.runtime.startCapture(capture));
		await vi.waitFor(() =>
			expect(
				f.events.some(
					(e) =>
						e._tag === "Stage" &&
						e.stage._tag === "recording" &&
						e.stage.status === "listening",
				),
			).toBe(true),
		);
		await f.voice.runPromise(
			f.runtime.releaseCapture(capture.serial, capture.keyCode, 1),
		);
		await vi.waitFor(() => expect(f.requests).toHaveLength(1));
		expect(f.requests[0]?.messages.at(-1)?.content).toBe(
			"Private finalized transcript",
		);
		expect(f.directRequests).toHaveLength(0);
		expect(f.old).not.toHaveBeenCalled();
	} finally {
		await f.close();
	}
});

it.each(["voice", "speech", "connection", "local-model"])(
	"PR128 assistant capture preserves %s admission",
	async (gate) => {
		const f = await fixture(
			await scratch(),
			gate !== "local-model",
			true,
			false,
			true,
			false,
		);
		try {
			if (gate === "voice") f.setVoice(false);
			if (gate === "connection") f.setConnected(false);
			if (gate === "speech")
				await f.background.runPromise(
					f.binding.settings.request({
						_tag: "Save",
						settings: { version: 1, speakAnswers: false },
					}),
				);
			await f.voice.runPromise(f.runtime.startCapture(capture));
			await vi.waitFor(() =>
				expect(
					f.events.some((e) => e._tag === "Stage" && e.stage._tag === "failed"),
				).toBe(true),
			);
			expect(
				f.events.some(
					(e) =>
						e._tag === "Stage" &&
						e.stage._tag === "recording" &&
						e.stage.status === "listening",
				),
			).toBe(false);
			expect(f.requests).toHaveLength(0);
			expect(f.directRequests).toHaveLength(0);
			expect(f.closed()).toBe(0);
		} finally {
			await f.close();
		}
	},
);

it.each(["external", "direct"])(
	"PR128 %s capture retains its prepared destination through selection changes",
	async (route) => {
		const f = await fixture(
			await scratch(),
			route === "external",
			true,
			true,
			true,
		);
		try {
			await f.voice.runPromise(f.runtime.startCapture(capture));
			await vi.waitFor(() =>
				expect(
					f.events.some(
						(e) =>
							e._tag === "Stage" &&
							e.stage._tag === "recording" &&
							e.stage.status === "listening",
					),
				).toBe(true),
			);
			f.setSelected(route !== "external");
			await f.voice.runPromise(
				f.runtime.releaseCapture(capture.serial, capture.keyCode, 1),
			);
			if (route === "external") {
				await vi.waitFor(() =>
					expect(
						f.events.some(
							(e) => e._tag === "Stage" && e.stage._tag === "failed",
						),
					).toBe(true),
				);
				expect(f.requests).toHaveLength(0);
				expect(f.directRequests).toHaveLength(0);
			} else {
				await vi.waitFor(() => expect(f.directRequests).toHaveLength(1));
				expect(f.requests).toHaveLength(0);
			}
			expect(f.old).not.toHaveBeenCalled();
		} finally {
			await f.close();
		}
	},
);

it("PR128 early release interrupts destination preparation and frees capture admission", async () => {
	const f = await fixture(await scratch(), true, true, false, true, false);
	try {
		f.delayPreparation(true);
		await f.voice.runPromise(f.runtime.startCapture(capture));
		await vi.waitFor(() => expect(f.preparationStarted()).toBe(true));
		await f.voice.runPromise(
			f.runtime.releaseCapture(capture.serial, capture.keyCode, 1),
		);
		expect(f.requests).toHaveLength(0);
		expect(f.closed()).toBe(0);
		f.delayPreparation(false);
		await f.voice.runPromise(
			f.runtime.startCapture({
				...capture,
				generation: 2,
				captureId: "capture-2",
			}),
		);
		await vi.waitFor(() =>
			expect(
				f.events.some(
					(e) =>
						e._tag === "Stage" &&
						e.captureId === "capture-2" &&
						e.stage._tag === "recording" &&
						e.stage.status === "listening",
				),
			).toBe(true),
		);
		await f.voice.runPromise(
			f.runtime.cancelCapture(capture.serial, capture.keyCode, 2),
		);
		expect(f.requests).toHaveLength(0);
		expect(f.closed()).toBe(1);
	} finally {
		await f.close();
	}
});
