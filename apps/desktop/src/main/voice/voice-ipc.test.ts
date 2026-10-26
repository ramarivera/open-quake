import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Either, Layer, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts";
import { GridVoiceRuntime } from "../../../../../packages/edge/src/voice/surface";
import type { CaptureRequest } from "../../../../../packages/edge/src/voice/surface/voice-surface-ports";
import {
	VOICE_REQUEST_CHANNEL,
	VOICE_SURFACE_CHANNEL,
	VoiceSurfaceEvent,
	VoiceSurfaceReply,
} from "../../shared/voice-surface";
import {
	createDesktopDiagnostics,
	type DesktopDiagnostics,
} from "../diagnostics";
import { copilotProfile } from "../test/voice-fixtures";
import { meetingAdmission } from "./admission";
import { createToneRecorder, registerVoiceSurface } from "./index";

const RENDERER = "file:///app/out/renderer/index.html";
const electron = vi.hoisted(() => {
	const mainFrame = {};
	const webContents = {
		send: vi.fn<(channel: string, value: unknown) => void>(),
		isDestroyed: () => false,
		mainFrame,
		getURL: vi.fn(() => "file:///app/out/renderer/index.html?surface=panel"),
	};
	const window = {
		isDestroyed: () => false,
		webContents,
		focus: vi.fn(),
	};
	return {
		webContents,
		window,
		BrowserWindow: {
			getAllWindows: vi.fn(() => [window]),
			fromWebContents: vi.fn(() => window),
		},
		ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
		shell: { openExternal: vi.fn(async () => undefined) },
		clipboard: { writeText: vi.fn() },
		dialog: {
			showOpenDialog: vi.fn(async () => ({
				canceled: false,
				filePaths: ["/Users/me/report.pdf"],
			})),
		},
	};
});
vi.mock("electron", () => electron);

const decodeReply = Schema.decodeUnknownSync(VoiceSurfaceReply);
const decodeEvent = Schema.decodeUnknownEither(VoiceSurfaceEvent);
type Handler = (event: unknown, raw: unknown) => Promise<unknown>;

function setup(mock = false, diagnostics?: DesktopDiagnostics) {
	const tones = createToneRecorder();
	const registration = registerVoiceSurface({
		mock,
		...(diagnostics ? { diagnostics } : {}),
		tones,
		serial: () => "QK-1",
		panel: () => undefined,
		management: () => undefined,
		renderer: RENDERER,
	});
	const handler = electron.ipcMain.handle.mock.calls.find(
		([channel]) => channel === VOICE_REQUEST_CHANNEL,
	)?.[1];
	if (typeof handler !== "function") throw new Error("No voice handler");
	const invoke: Handler = (event, raw) => handler(event, raw);
	const request = async (
		raw: unknown,
		event: unknown = {
			sender: electron.webContents,
			senderFrame: electron.webContents.mainFrame,
		},
	) => decodeReply(await invoke(event, raw));
	return { registration, request, tones };
}
const sent = () =>
	electron.webContents.send.mock.calls
		.filter(([channel]) => channel === VOICE_SURFACE_CHANNEL)
		.map(([, value]) => decodeEvent(value));

afterEach(() => {
	vi.clearAllMocks();
});

it("authorizes reader IPC from the committed active AudioBot key and settings, rejecting other keys and frames", async () => {
	const committed = {
		engine: "webSpeech",
		voiceHint: "saved",
		rate: 1,
		pitch: 1,
		volume: 0.5,
	} as const;
	let envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
		schemaVersion: 1,
		profiles: [
			{
				...copilotProfile,
				pages: copilotProfile.pages.map((page) => ({
					...page,
					keys: page.keys.map((key) =>
						key.keyCode !== "2,8"
							? key
							: {
									...key,
									childrenName: "audioBot",
									config: {
										...key.config,
										type: "audioBot",
										actions: [
											{ type: "agentId", value: "saved-agent" },
											{ type: "modeltype", value: "saved-model" },
											{ type: "ttsEngine", value: "webSpeech" },
											{ type: "ttsVoice", value: "saved" },
											{ type: "ttsVolume", value: 0.5 },
										],
									},
								},
					),
				})),
			},
		],
		activeByDevice: {
			"QK-1": {
				profileId: copilotProfile.id,
				pageId: copilotProfile.pages[0].id,
			},
		},
	});
	const toggleReader = vi.fn(async () => undefined);
	const profiles = vi.fn(async () => envelope);
	const registration = registerVoiceSurface({
		mock: true,
		tones: createToneRecorder(),
		serial: () => "QK-1",
		panel: () => undefined,
		management: () => undefined,
		renderer: RENDERER,
		profiles,
		speech: {
			toggleReader,
			readAloud: async () => ({ _tag: "ok" }),
			onEvent: () => {},
		},
	});
	try {
		const handler = electron.ipcMain.handle.mock.calls.at(-1)?.[1];
		if (typeof handler !== "function") throw new Error("No handler");
		const frame = {
			sender: electron.webContents,
			senderFrame: electron.webContents.mainFrame,
		};
		const raw = {
			_tag: "ToggleReader",
			keyCode: "2,8",
			settings: { ...committed, voiceHint: "forged" },
		};
		for (const keyCode of ["1,6", "9,9"]) {
			expect(await handler(frame, { ...raw, keyCode })).toEqual({
				_tag: "rejected",
				code: "VOICE.SURFACE.REQUEST_INVALID",
			});
		}
		expect(await handler({ ...frame, senderFrame: {} }, raw)).toEqual({
			_tag: "rejected",
			code: "VOICE.SURFACE.REQUEST_INVALID",
		});
		expect(toggleReader).not.toHaveBeenCalled();
		expect(await handler(frame, raw)).toEqual({ _tag: "ok" });
		expect(toggleReader).toHaveBeenCalledExactlyOnceWith(
			{ serial: "QK-1", keyCode: "2,8" },
			committed,
		);
		envelope = {
			...envelope,
			activeByDevice: { "QK-1": { profileId: "missing", pageId: "missing" } },
		};
		expect(await handler(frame, raw)).toEqual({
			_tag: "rejected",
			code: "VOICE.SURFACE.REQUEST_INVALID",
		});
		expect(toggleReader).toHaveBeenCalledTimes(1);
		profiles.mockRejectedValueOnce(new Error("Storage unavailable"));
		expect(await handler(frame, raw)).toEqual({
			_tag: "rejected",
			code: "VOICE.SURFACE.REQUEST_INVALID",
		});
		expect(toggleReader).toHaveBeenCalledTimes(1);
	} finally {
		await registration.dispose();
	}
});

describe("voice:request", () => {
	it("gates queued holds on link loss and broadcasts reset before accepting reconnect input", async () => {
		const { request, registration } = setup(true);
		try {
			await request({
				_tag: "Input",
				input: {
					keyCode: "1,5",
					type: "clawbot",
					voiceInput: true,
					kind: "down",
				},
			});
			const reset = registration.onDevice({
				source: "mock",
				kind: "status",
				state: "disconnected",
				reason: "transport-ended",
			});
			expect(
				await request({
					_tag: "Input",
					input: { keyCode: "1,5", type: "clawbot", kind: "touchEnd" },
				}),
			).toEqual({
				_tag: "rejected",
				code: "VOICE.SURFACE.DEVICE_DISCONNECTED",
			});
			await reset;
			const events = sent().flatMap((event) =>
				Either.isRight(event) ? [event.right] : [],
			);
			expect(events.at(-1)).toEqual({
				_tag: "Reset",
				serial: "QK-1",
				reason: "disconnected",
			});
			expect(
				events.some(
					(event) => event._tag === "Stage" || event._tag === "TurnStarted",
				),
			).toBe(false);
			await registration.onDevice({
				source: "mock",
				kind: "status",
				state: "connected",
			});
			expect(
				await request({
					_tag: "Input",
					input: { keyCode: "1,6", type: "aiChat", kind: "down" },
				}),
			).toEqual({ _tag: "ok" });
		} finally {
			await registration.dispose();
		}
	});
	it("answers Hello with the agent status on the sender only", async () => {
		const { request, registration } = setup();
		expect(await request({ _tag: "Hello" })).toEqual({ _tag: "ok" });
		const events = sent().flatMap((event) =>
			Either.isRight(event) ? [event.right] : [],
		);
		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({
			_tag: "AgentStatus",
			state: "noService",
		});
		await registration.dispose();
	});

	it("rejects other origins, subframes and malformed payloads", async () => {
		const { request, registration } = setup();
		electron.webContents.getURL.mockReturnValueOnce("https://evil.example/");
		expect(await request({ _tag: "Hello" })).toEqual({
			_tag: "rejected",
			code: "VOICE.SURFACE.REQUEST_INVALID",
		});
		expect(
			await request(
				{ _tag: "Hello" },
				{ sender: electron.webContents, senderFrame: {} },
			),
		).toMatchObject({ _tag: "rejected" });
		expect(
			await request({
				_tag: "Input",
				input: { keyCode: "1,6", kind: "explode", type: "aiChat" },
			}),
		).toMatchObject({ _tag: "rejected" });
		expect(await request({ _tag: "Hello", extra: 1 })).toMatchObject({
			_tag: "rejected",
		});
		await registration.dispose();
	});

	it("opens only safe links and copies trimmed text", async () => {
		const { request, registration } = setup();
		expect(
			await request({ _tag: "OpenLink", url: "javascript:alert(1)" }),
		).toEqual({ _tag: "rejected", code: "VOICE.SURFACE.LINK_REJECTED" });
		expect(electron.shell.openExternal).not.toHaveBeenCalled();
		expect(
			await request({ _tag: "OpenLink", url: "https://example.com/x" }),
		).toEqual({ _tag: "ok" });
		expect(electron.shell.openExternal).toHaveBeenCalledWith(
			"https://example.com/x",
		);
		await request({ _tag: "CopyText", text: "  answer \n" });
		expect(electron.clipboard.writeText).toHaveBeenCalledWith("answer");
		await registration.dispose();
	});

	it("returns picked file paths and refuses text-to-speech it cannot play", async () => {
		const { request, registration } = setup();
		expect(await request({ _tag: "PickFiles" })).toEqual({
			_tag: "files",
			paths: ["/Users/me/report.pdf"],
		});
		expect(await request({ _tag: "ReadAloud", keyCode: "1,1" })).toEqual({
			_tag: "rejected",
			code: "VOICE.TTS.UNAVAILABLE",
		});
		await registration.dispose();
	});

	it("broadcasts published events with feedback, and records tones without HID", async () => {
		const { registration, tones } = setup();
		await registration.publish({
			_tag: "Stage",
			serial: "QK-1",
			keyCode: "1,6",
			captureId: "c",
			stage: { _tag: "failed", reason: "server" },
		});
		const events = sent().map((event) =>
			Either.isRight(event) ? event.right._tag : "invalid",
		);
		expect(events).toEqual(["Stage", "KeyAlert"]);
		expect(tones.played()).toEqual([{ serial: "QK-1", tone: "error" }]);
		await registration.dispose();
		expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith(
			VOICE_REQUEST_CHANNEL,
		);
	});

	it("publishes failed/unavailable when a typed send has no runtime", async () => {
		const { request, registration } = setup();
		expect(
			await request({
				_tag: "SendText",
				keyCode: "1,7",
				agentId: "weather",
				message: "hi",
			}),
		).toEqual({ _tag: "rejected", code: "VOICE.GRID.RUNTIME_UNAVAILABLE" });
		const stage = sent()
			.flatMap((event) => (Either.isRight(event) ? [event.right] : []))
			.find((event) => event._tag === "Stage");
		expect(stage).toMatchObject({
			stage: { _tag: "failed", reason: "unavailable" },
		});
		await registration.dispose();
	});

	it("acknowledges a typed send accepted by the mock runtime", async () => {
		const { request, registration } = setup(true);
		try {
			expect(
				await request({
					_tag: "SendText",
					keyCode: "1,5",
					agentId: "weather",
					message: "hello",
				}),
			).toEqual({ _tag: "ok" });
			await vi.waitFor(() =>
				expect(
					sent().some(
						(event) =>
							Either.isRight(event) && event.right._tag === "TurnStarted",
					),
				).toBe(true),
			);
		} finally {
			await registration.dispose();
		}
	});
});

it.each(["release", "cancel", "disconnect"] as const)(
	"latches %s while committed knob resolution is pending",
	async (action) => {
		const entered = await Effect.runPromise(Deferred.make<void>());
		const release = await Effect.runPromise(Deferred.make<void>());
		const lookupFinished = await Effect.runPromise(Deferred.make<void>());
		const startCapture = vi.fn((_request: CaptureRequest) => Effect.void);
		const registration = registerVoiceSurface({
			mock: true,
			tones: createToneRecorder(),
			serial: () => "QK-1",
			panel: () => undefined,
			management: () => undefined,
			renderer: RENDERER,
			knobRoute: () =>
				Deferred.succeed(entered, undefined).pipe(
					Effect.zipRight(Deferred.await(release)),
					Effect.ensuring(Deferred.succeed(lookupFinished, undefined)),
					Effect.as({
						profileId: "p",
						revision: 1,
						route: "direct" as const,
						providerId: "saved",
						modelId: "model",
					}),
				),
			runtime: () =>
				Layer.succeed(GridVoiceRuntime, {
					select: () => Effect.void,
					startCapture,
					releaseCapture: () => Effect.void,
					cancelCapture: () => Effect.void,
					cancelFlow: () => Effect.void,
					sendText: () => Effect.void,
				}),
		});
		try {
			const starting = Effect.runPromise(
				registration.knobVoice({ action: "holdStart", generation: 1 }),
			);
			await Effect.runPromise(Deferred.await(entered));
			if (action === "disconnect")
				await registration.onDevice({
					kind: "status",
					state: "disconnected",
					reason: "requested",
					source: "mock",
				});
			else
				await Effect.runPromise(
					registration.knobVoice({ action, generation: 1 }),
				);
			await Effect.runPromise(Deferred.succeed(release, undefined));
			await starting;
			await Effect.runPromise(Deferred.await(lookupFinished));
			await new Promise<void>((done) => setImmediate(done));
			expect(startCapture).not.toHaveBeenCalled();
		} finally {
			await registration.dispose();
		}
	},
);

it("hands the committed profile and revision into capture and rejects a stale session", async () => {
	const startCapture = vi.fn((_request: CaptureRequest) => Effect.void);
	const snapshot = {
		profileId: "p",
		revision: 4,
		route: "direct" as const,
		providerId: "saved",
		modelId: "org/model",
	};
	const registration = registerVoiceSurface({
		mock: true,
		tones: createToneRecorder(),
		serial: () => "QK-1",
		panel: () => undefined,
		management: () => undefined,
		renderer: RENDERER,
		knobRoute: () => Effect.succeed(snapshot),
		runtime: () =>
			Layer.succeed(GridVoiceRuntime, {
				select: () => Effect.void,
				startCapture,
				releaseCapture: () => Effect.void,
				cancelCapture: () => Effect.void,
				cancelFlow: () => Effect.void,
				sendText: () => Effect.void,
			}),
	});
	try {
		await Effect.runPromise(
			registration.knobVoice({
				action: "holdStart",
				generation: 1,
				session: { deviceId: "QK-1", profileId: "p", revision: 4 },
			}),
		);
		await vi.waitFor(() =>
			expect(startCapture).toHaveBeenCalledWith(
				expect.objectContaining({
					serial: "QK-1",
					keyCode: "0,1",
					knob: snapshot,
				}),
			),
		);
		await Effect.runPromise(
			registration.knobVoice({
				action: "holdStart",
				generation: 2,
				session: { deviceId: "QK-1", profileId: "p", revision: 3 },
			}),
		);
		await vi.waitFor(() =>
			expect(
				sent().some(
					(e) =>
						Either.isRight(e) &&
						e.right._tag === "Stage" &&
						e.right.stage._tag === "failed" &&
						e.right.stage.errorCode === "VOICE.KNOB.ROUTE_INCOMPLETE",
				),
			).toBe(true),
		);
		expect(startCapture).toHaveBeenCalledTimes(1);
	} finally {
		await registration.dispose();
	}
});

it("routes Read Aloud through the selected speech consumer using accumulated real answer chunks", async () => {
	const { Schema } = await import("effect");
	const { SessionId, TurnId } = await import(
		"../../../../../packages/edge/src/chat/chat-contracts"
	);
	const sessionId = Schema.decodeUnknownSync(SessionId)(crypto.randomUUID());
	const turnId = Schema.decodeUnknownSync(TurnId)(crypto.randomUUID());
	const readAloud = vi.fn(async (_text: string) => ({ _tag: "ok" }) as const);
	const observe = vi.fn((_event: unknown) => undefined);
	const registration = registerVoiceSurface({
		mock: false,
		tones: createToneRecorder(),
		serial: () => "QK-1",
		panel: () => undefined,
		management: () => undefined,
		renderer: RENDERER,
		speech: { readAloud, onEvent: observe },
	});
	try {
		const handler = electron.ipcMain.handle.mock.calls.find(
			([channel]) => channel === VOICE_REQUEST_CHANNEL,
		)?.[1];
		if (!handler) throw new Error("missing voice handler");
		await registration.publish({
			_tag: "TurnStarted",
			serial: "QK-1",
			keyCode: "1,5",
			sessionId,
			turnId,
			prompt: "input",
			source: "typed",
		});
		await registration.publish({
			_tag: "Chunk",
			serial: "QK-1",
			keyCode: "1,5",
			chunk: {
				version: 1,
				sessionId,
				turnId,
				seq: 0,
				type: "answer",
				textDelta: "Readable answer.",
			},
		});
		await registration.publish({
			_tag: "Chunk",
			serial: "QK-1",
			keyCode: "1,5",
			chunk: {
				version: 1,
				sessionId,
				turnId,
				seq: 1,
				type: "followUp",
				suggestionId: "one",
				text: "Never speak this.",
			},
		});
		const reply = decodeReply(
			await handler(
				{
					sender: electron.webContents,
					senderFrame: electron.webContents.mainFrame,
				},
				{ _tag: "ReadAloud", keyCode: "1,5" },
			),
		);
		expect(reply).toEqual({ _tag: "ok" });
		expect(readAloud).toHaveBeenCalledExactlyOnceWith("Readable answer.", {
			serial: "QK-1",
			keyCode: "1,5",
		});
		expect(observe).toHaveBeenCalledTimes(3);
		await registration.publish({
			_tag: "Chunk",
			serial: "QK-1",
			keyCode: "1,5",
			chunk: {
				version: 1,
				sessionId,
				turnId,
				seq: 2,
				type: "answer",
				textDelta: "x".repeat(4000),
			},
		});
		expect(
			decodeReply(
				await handler(
					{
						sender: electron.webContents,
						senderFrame: electron.webContents.mainFrame,
					},
					{ _tag: "ReadAloud", keyCode: "1,5" },
				),
			),
		).toEqual({ _tag: "rejected", code: "VOICE.TTS.QUEUE_FULL" });
		expect(readAloud).toHaveBeenCalledTimes(1);
		await registration.reset();
		expect(
			decodeReply(
				await handler(
					{
						sender: electron.webContents,
						senderFrame: electron.webContents.mainFrame,
					},
					{ _tag: "ReadAloud", keyCode: "1,5" },
				),
			),
		).toMatchObject({ _tag: "rejected" });
	} finally {
		await registration.dispose();
	}
});

it.each(["overflow", "empty"])(
	"stop tap precedes %s answer validation for active read-aloud",
	async (answerState) => {
		const { SessionId, TurnId } = await import(
			"../../../../../packages/edge/src/chat/chat-contracts"
		);
		const sessionId = SessionId.make(crypto.randomUUID());
		const turnId = TurnId.make(crypto.randomUUID());
		const owner = { serial: "QK-1", keyCode: "1,5" };
		const readAloud = vi.fn(async () => ({ _tag: "ok" }) as const);
		let active = true;
		const stopReadAloud = vi.fn(async (request: typeof owner) => {
			if (
				active &&
				request.serial === owner.serial &&
				request.keyCode === owner.keyCode
			) {
				active = false;
				return true;
			}
			return false;
		});
		const registration = registerVoiceSurface({
			mock: false,
			tones: createToneRecorder(),
			serial: () => "QK-1",
			panel: () => undefined,
			management: () => undefined,
			renderer: RENDERER,
			speech: { readAloud, stopReadAloud, onEvent: () => {} },
		});
		try {
			const handler = electron.ipcMain.handle.mock.calls.find(
				([channel]) => channel === VOICE_REQUEST_CHANNEL,
			)?.[1];
			if (!handler) throw new Error("missing voice handler");
			await registration.publish({
				_tag: "TurnStarted",
				...owner,
				sessionId,
				turnId,
				prompt: "New answer",
				source: "typed",
			});
			if (answerState === "overflow")
				await registration.publish({
					_tag: "Chunk",
					...owner,
					chunk: {
						version: 1,
						sessionId,
						turnId,
						seq: 0,
						type: "answer",
						textDelta: "x".repeat(4001),
					},
				});
			const tap = () =>
				handler(
					{
						sender: electron.webContents,
						senderFrame: electron.webContents.mainFrame,
					},
					{ _tag: "ReadAloud", keyCode: owner.keyCode },
				);
			expect(decodeReply(await tap())).toEqual({ _tag: "ok" });
			expect(stopReadAloud).toHaveBeenCalledExactlyOnceWith(owner);
			expect(active).toBe(false);
			expect(readAloud).not.toHaveBeenCalled();
			expect(decodeReply(await tap())).toEqual({
				_tag: "rejected",
				code:
					answerState === "overflow"
						? "VOICE.TTS.QUEUE_FULL"
						: "VOICE.TTS.UNAVAILABLE",
			});
		} finally {
			await registration.dispose();
		}
	},
);

it("retains the original failed voice span through actual IPC recovery without retaining text", async () => {
	const root =
		process.env.OPEN_QUAKE_TEST_SCRATCH ??
		join(homedir(), "dev/agentic-scratchpads/open-quake/tests");
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(join(root, "voice-diagnostics-"));
	const diagnostics = createDesktopDiagnostics({ directory });
	const { request, registration } = setup(false, diagnostics);
	try {
		expect(
			await request({
				_tag: "SendText",
				keyCode: "1,5",
				agentId: "private-local-agent",
				message: "private utterance",
			}),
		).toMatchObject({
			_tag: "rejected",
			code: "VOICE.GRID.RUNTIME_UNAVAILABLE",
		});
	} finally {
		await registration.dispose();
		await diagnostics.close();
	}
	const output = await readFile(
		join(directory, "diagnostics.0.ndjson"),
		"utf8",
	);
	expect(output).toContain('"span_name":"GridVoice.sendText"');
	expect(output).toContain('"outcome":"failure"');
	expect(output).toContain('"code":"VOICE.GRID.RUNTIME_UNAVAILABLE"');
	expect(output).not.toContain("private utterance");
	expect(output).not.toContain("private-local-agent");
	await rm(directory, { recursive: true });
});

it("AI-185: cancelled picker returns no paths and dispatches no turn", async () => {
	const { request, registration } = setup();
	try {
		electron.dialog.showOpenDialog.mockResolvedValueOnce({
			canceled: true,
			filePaths: ["/must/not/append.txt"],
		});
		expect(await request({ _tag: "PickFiles" })).toEqual({
			_tag: "files",
			paths: [],
		});
		expect(sent()).toHaveLength(0);
	} finally {
		await registration.dispose();
	}
});

it("KNOB-008/064 SCREEN-050: desktop meeting/translation admission reaches real IPC before capture and releases without reset", async () => {
	let state = { records: [{ state: "recording" }], translating: false };
	const tones = createToneRecorder();
	const registration = registerVoiceSurface({
		mock: true,
		tones,
		serial: () => "QK-1",
		panel: () => undefined,
		management: () => undefined,
		renderer: RENDERER,
		admission: meetingAdmission(async () => state),
	});
	try {
		await Effect.runPromise(
			registration.knobVoice({ action: "holdStart", generation: 1 }),
		);
		await vi.waitFor(() => expect(tones.played()).toHaveLength(1));
		expect(
			sent()
				.filter(Either.isRight)
				.map((value) => value.right)
				.at(-1),
		).toMatchObject({
			_tag: "Toast",
			messageKey: "meetingAssistantPrompt.meetingActive",
		});
		state = { records: [], translating: true };
		await Effect.runPromise(
			registration.knobVoice({ action: "holdStart", generation: 2 }),
		);
		await vi.waitFor(() => expect(tones.played()).toHaveLength(2));
		expect(
			sent()
				.filter(Either.isRight)
				.map((value) => value.right)
				.at(-1),
		).toMatchObject({
			_tag: "Toast",
			messageKey: "meetingAssistantPrompt.liveTranslateActive",
		});
		expect(tones.played().map((value) => value.tone)).toEqual(["busy", "busy"]);
		state = { records: [], translating: false };
		await Effect.runPromise(
			registration.knobVoice({ action: "holdStart", generation: 3 }),
		);
		await vi.waitFor(() =>
			expect(
				sent()
					.filter(Either.isRight)
					.some(
						(value) =>
							value.right._tag === "Stage" &&
							value.right.stage._tag === "recording",
					),
			).toBe(true),
		);
		expect(
			sent()
				.filter(Either.isRight)
				.some(
					(value) =>
						value.right._tag === "Stage" &&
						value.right.stage._tag === "recording",
				),
		).toBe(true);
	} finally {
		await registration.dispose();
	}
});
