import { Either, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	VOICE_REQUEST_CHANNEL,
	VOICE_SURFACE_CHANNEL,
	VoiceSurfaceEvent,
	VoiceSurfaceReply,
} from "../../shared/voice-surface";
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

function setup(mock = false) {
	const tones = createToneRecorder();
	const registration = registerVoiceSurface({
		mock,
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
		expect(readAloud).toHaveBeenCalledExactlyOnceWith("Readable answer.");
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
