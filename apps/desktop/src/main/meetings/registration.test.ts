import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Option, Schema } from "effect";
import { beforeEach, expect, it, vi } from "vitest";
import {
	type MeetingConfig,
	MeetingStore,
} from "../../../../../packages/edge/src/meetings/meeting-contracts";
import { MeetingService } from "../../../../../packages/edge/src/meetings/meeting-service";
import {
	CAPTURE_CHUNK,
	CAPTURE_LOST,
	CAPTURE_PCM,
	MEETING_REQUEST,
	MeetingReply,
} from "../../shared/meeting-bridge";

const ipc = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
	handle: vi.fn(),
	removeHandler: vi.fn(),
	on: vi.fn(),
	removeListener: vi.fn(),
	reveal: vi.fn(),
	app: { on: vi.fn(), removeListener: vi.fn(), quit: vi.fn() },
}));
const capture = vi.hoisted(() => ({
	id: "",
	written: vi.fn(),
	stopped: vi.fn(),
	created: vi.fn(),
	disposed: vi.fn(),
	lost: (_id: string) => {},
	wait: (): Promise<void> => Promise.resolve(),
	acquisition: undefined as Promise<void> | undefined,
}));
vi.mock("../diagnostics/runtime", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../diagnostics/runtime")>();
	return {
		...original,
		makeDesktopRuntime: (
			...args: Parameters<typeof original.makeDesktopRuntime>
		) => {
			const waiting = capture.acquisition;
			return original.makeDesktopRuntime(
				waiting
					? args[0].pipe(
							Layer.provide(Layer.effectDiscard(Effect.promise(() => waiting))),
						)
					: args[0],
				args[1],
				args[2],
			);
		},
	};
});
vi.mock("electron", () => ({
	app: ipc.app,
	ipcMain: ipc,
	BrowserWindow: { getAllWindows: () => [], fromWebContents: () => ({}) },
	dialog: {},
	shell: { showItemInFolder: ipc.reveal },
}));
vi.mock("./capture-port", () => ({
	createCapturePort: (options: { onLost: (id: string) => void }) => {
		capture.created();
		capture.lost = options.onLost;
		return {
			port: {
				mic: () => Effect.succeed(Option.none()),
				start: (id: string, config: MeetingConfig) =>
					Effect.sync(() => {
						capture.id = id;
						return config;
					}),
				drain: () => Effect.void,
				stop: () =>
					Effect.sync(() => {
						capture.stopped();
					}),
				cancel: () =>
					Effect.promise(async () => {
						await ipc.handlers.get("meetings:chunk")?.(
							{},
							{
								id: capture.id,
								track: "mic",
								segment: 0,
								bytes: new Uint8Array([1, 2, 3]),
							},
						);
					}),
				startTranslation: () => Effect.void,
				stopTranslation: () => Effect.void,
			},
			accepts: (event: { command?: boolean }) => !event.command,
			active: () => true,
			files: {
				write: () =>
					Effect.promise(async () => {
						capture.written();
						await capture.wait();
					}),
			},
			dispose: capture.disposed,
		};
	},
}));

import { makeDesktopRuntime } from "../diagnostics/runtime";
import { prepareMeetings, registerMeetings } from "./index";

beforeEach(() => {
	ipc.handlers.clear();
	capture.wait = () => Promise.resolve();
	capture.acquisition = undefined;
	ipc.handle.mockImplementation(
		(name: string, handler: (...args: unknown[]) => Promise<unknown>) => {
			ipc.handlers.set(name, handler);
		},
	);
	ipc.removeHandler.mockImplementation((name: string) => {
		ipc.handlers.delete(name);
	});
});

it("prepares without capture listeners and releases them once under shared ownership", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-meetings-shared-"));
	capture.created.mockClear();
	capture.disposed.mockClear();
	const calls = ipc.handle.mock.calls.length;
	const quitListeners = ipc.app.on.mock.calls.length;
	const module = prepareMeetings({
		userData: root,
		mock: true,
		hardware: () => undefined,
	});
	expect(capture.created).not.toHaveBeenCalled();
	expect(ipc.handle.mock.calls).toHaveLength(calls);
	const application = makeDesktopRuntime(module.layer);
	module.bind(application);
	try {
		await application.runtime();
		expect(capture.created).toHaveBeenCalledOnce();
		const meetings = module.start();
		await meetings.ready;
		expect(ipc.app.on.mock.calls).toHaveLength(quitListeners);
		await meetings.dispose();
		expect(capture.disposed).not.toHaveBeenCalled();
		await application.runPromise(MeetingService.action("liveAudioTranslate"));
		expect(
			(await application.runPromise(MeetingService.snapshot())).translating,
		).toBe(true);
		expect(ipc.handlers.has(CAPTURE_CHUNK)).toBe(true);
		expect(ipc.handlers.has(CAPTURE_PCM)).toBe(true);
		await expect(
			ipc.handlers.get(CAPTURE_PCM)?.({}, new Uint8Array([0, 0])),
		).resolves.toBeUndefined();
		await application.runPromise(MeetingService.action("meetingMinutes"));
		let release = () => {};
		capture.wait = () =>
			new Promise<void>((resolve) => {
				release = resolve;
			});
		const disposal = application.dispose();
		try {
			await vi.waitFor(() => expect(capture.written).toHaveBeenCalledOnce());
			expect(ipc.handlers.has(CAPTURE_CHUNK)).toBe(true);
			expect(capture.disposed).not.toHaveBeenCalled();
		} finally {
			release();
			await disposal;
		}
		expect(capture.disposed).toHaveBeenCalledOnce();
		expect(ipc.handlers.has(CAPTURE_CHUNK)).toBe(false);
		expect(ipc.handlers.has(CAPTURE_PCM)).toBe(false);
	} finally {
		await application.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it("keeps audio IPC registered until shutdown has drained the last dataavailable write", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-meetings-quit-"));
	const meetings = registerMeetings({
		userData: root,
		mock: true,
		hardware: () => undefined,
	});
	try {
		await meetings.ready;
		await meetings.runtime.runPromise(MeetingService.action("meetingMinutes"));
		expect(ipc.handlers.has(CAPTURE_CHUNK)).toBe(true);
		await meetings.dispose();
		expect(capture.written).toHaveBeenCalledOnce();
		expect(ipc.handlers.has(CAPTURE_CHUNK)).toBe(false);
	} finally {
		await meetings.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it("keeps its quit veto installed while final chunk IO is still pending", async () => {
	let release = () => {};
	capture.wait = () =>
		new Promise<void>((resolve) => {
			release = resolve;
		});
	const root = await mkdtemp(join(tmpdir(), "oq-meetings-veto-"));
	const meetings = registerMeetings({
		userData: root,
		mock: true,
		hardware: () => undefined,
	});
	try {
		await meetings.ready;
		await meetings.runtime.runPromise(MeetingService.action("meetingMinutes"));
		const quit = ipc.app.on.mock.calls.find(
			(call) => call[0] === "before-quit",
		)?.[1];
		if (typeof quit !== "function") throw new Error("Missing quit listener");
		const disposal = meetings.dispose();
		await vi.waitFor(() => expect(capture.written).toHaveBeenCalledOnce());
		expect(ipc.app.removeListener).not.toHaveBeenCalledWith(
			"before-quit",
			quit,
		);
		const preventDefault = vi.fn();
		quit({ preventDefault });
		expect(preventDefault).toHaveBeenCalledOnce();
		expect(meetings.dispose()).toBe(disposal);
		expect(ipc.app.quit).not.toHaveBeenCalled();
		release();
		await disposal;
		expect(ipc.app.removeListener).toHaveBeenCalledWith("before-quit", quit);
	} finally {
		release();
		await meetings.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it("clears standalone translating state and stops the provider after capture loss", async () => {
	const { mockMeetingAdapter } = await import("./index");
	const stop = vi.fn();
	const root = await mkdtemp(join(tmpdir(), "oq-meetings-translation-"));
	const meetings = registerMeetings({
		userData: root,
		mock: true,
		hardware: () => undefined,
		adapter: {
			...mockMeetingAdapter,
			stopTranslation: () => Effect.sync(stop),
		},
	});
	try {
		await meetings.ready;
		await meetings.runtime.runPromise(
			MeetingService.action("liveAudioTranslate"),
		);
		expect(
			(await meetings.runtime.runPromise(MeetingService.snapshot()))
				.translating,
		).toBe(true);
		capture.lost("00000000-0000-4000-8000-000000000000");
		await vi.waitFor(async () =>
			expect(
				(await meetings.runtime.runPromise(MeetingService.snapshot()))
					.translating,
			).toBe(false),
		);
		expect(stop).toHaveBeenCalledOnce();
		expect(
			(await meetings.runtime.runPromise(MeetingService.snapshot())).notice,
		).toContain("source or provider is unavailable");
	} finally {
		await meetings.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it("keeps cancel and source loss coherent across concurrent production IPC requests", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-meetings-cancel-ipc-"));
	const renderer = "file:///synthetic-meetings/index.html";
	const meetings = registerMeetings({
		userData: root,
		renderer,
		mock: true,
		hardware: () => undefined,
	});
	let release = () => {};
	let entered = () => {};
	const writing = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	capture.wait = async () => {
		entered();
		await waiting;
	};
	const frame = {};
	const event = {
		command: true,
		senderFrame: frame,
		sender: { mainFrame: frame, getURL: () => renderer },
	};
	try {
		await meetings.ready;
		const handler = ipc.handlers.get(MEETING_REQUEST);
		if (!handler) throw new Error("Missing production meeting IPC");
		const started = Schema.decodeUnknownSync(MeetingReply)(
			await handler(event, { _tag: "action", action: "meetingMinutes" }),
		);
		if (started._tag !== "ready" || !started.snapshot.records[0])
			throw new Error("Missing recording");
		const id = started.snapshot.records[0].id;
		const cancelling = handler(event, { _tag: "cancel", id });
		await writing;
		capture.lost(id);
		// Reads proceed while cancel awaits final chunk IO: IPC has no request lock.
		const reading = Schema.decodeUnknownSync(MeetingReply)(
			await handler(event, { _tag: "read" }),
		);
		expect(reading._tag === "ready" && reading.snapshot.records[0]?.state).toBe(
			"recording",
		);
		expect(capture.stopped).not.toHaveBeenCalled();
		release();
		const cancelled = Schema.decodeUnknownSync(MeetingReply)(await cancelling);
		expect(
			cancelled._tag === "ready" && cancelled.snapshot.records[0]?.state,
		).toBe("cancelled");
		await meetings.runtime.runPromise(MeetingService.sourceLost(id));
		const durable = JSON.parse(
			await readFile(join(root, "meetings-v1/history.json"), "utf8"),
		) as unknown;
		const stored = Schema.decodeUnknownSync(MeetingStore)(durable);
		expect(stored.records[0]?.state).toBe("cancelled");
		expect(capture.stopped).not.toHaveBeenCalled();
		const deleted = Schema.decodeUnknownSync(MeetingReply)(
			await handler(event, { _tag: "delete", id, confirmed: true }),
		);
		expect(deleted._tag).toBe("ready");
		await meetings.runtime.runPromise(MeetingService.sourceLost(id));
		expect(
			(await meetings.runtime.runPromise(MeetingService.snapshot())).records,
		).toEqual([]);
	} finally {
		release();
		await meetings.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it("accepts an authorized request immediately after standalone registration", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-meetings-early-"));
	const renderer = "file:///synthetic-meetings/index.html";
	let release = () => {};
	capture.acquisition = new Promise<void>((resolve) => {
		release = resolve;
	});
	const meetings = registerMeetings({
		userData: root,
		renderer,
		mock: true,
		hardware: () => undefined,
	});
	const frame = {};
	const event = {
		command: true,
		senderFrame: frame,
		sender: { mainFrame: frame, getURL: () => renderer },
	};
	try {
		const handler = ipc.handlers.get(MEETING_REQUEST);
		if (!handler) throw new Error("Missing meeting handler");
		const replyPending = handler(event, { _tag: "read" });
		release();
		const reply = Schema.decodeUnknownSync(MeetingReply)(await replyPending);
		expect(reply._tag).toBe("ready");
	} finally {
		release();
		await meetings.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it("waits for acquisition before handling early capture chunks and PCM", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-meetings-early-audio-"));
	let release = () => {};
	capture.acquisition = new Promise<void>((resolve) => {
		release = resolve;
	});
	const meetings = registerMeetings({
		userData: root,
		mock: true,
		hardware: () => undefined,
	});
	try {
		const chunk = ipc.handlers.get(CAPTURE_CHUNK);
		const pcm = ipc.handlers.get(CAPTURE_PCM);
		if (!chunk || !pcm) throw new Error("Missing audio handlers");
		const pending = Promise.all([
			chunk(
				{},
				{
					id: "00000000-0000-4000-8000-000000000001",
					track: "mic",
					segment: 0,
					bytes: new Uint8Array([1, 2, 3]),
				},
			),
			pcm({}, new Uint8Array([0, 0])),
		]);
		release();
		await pending;
		expect(capture.written).toHaveBeenCalledOnce();
	} finally {
		release();
		await meetings.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it("returns a typed failure reply if standalone graph acquisition fails", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-meetings-early-failed-"));
	await mkdir(join(root, "meetings-v1"));
	await writeFile(join(root, "meetings-v1/history.json"), "broken", {
		mode: 0o600,
	});
	const renderer = "file:///synthetic-meetings/index.html";
	let release = () => {};
	capture.acquisition = new Promise<void>((resolve) => {
		release = resolve;
	});
	const meetings = registerMeetings({
		userData: root,
		renderer,
		mock: true,
		hardware: () => undefined,
	});
	const frame = {};
	const event = {
		command: true,
		senderFrame: frame,
		sender: { mainFrame: frame, getURL: () => renderer },
	};
	try {
		const handler = ipc.handlers.get(MEETING_REQUEST);
		if (!handler) throw new Error("Missing meeting handler");
		const replyPending = handler(event, { _tag: "read" });
		release();
		const reply = Schema.decodeUnknownSync(MeetingReply)(await replyPending);
		expect(reply._tag).toBe("failure");
		expect(reply._tag === "failure" && reply.code).toBe(
			"QUAKE.MEETING.STORAGE_FAILED",
		);
	} finally {
		release();
		await meetings.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it("rejects requests safely when capture acquisition itself throws", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-meetings-capture-failed-"));
	capture.created.mockImplementationOnce(() => {
		throw new TypeError("synthetic capture acquisition failure");
	});
	const renderer = "file:///synthetic-meetings/index.html";
	const meetings = registerMeetings({
		userData: root,
		renderer,
		mock: true,
		hardware: () => undefined,
	});
	const frame = {};
	const event = {
		command: true,
		senderFrame: frame,
		sender: { mainFrame: frame, getURL: () => renderer },
	};
	try {
		const handler = ipc.handlers.get(MEETING_REQUEST);
		if (!handler) throw new Error("Missing meeting handler");
		const reply = Schema.decodeUnknownSync(MeetingReply)(
			await handler(event, { _tag: "read" }),
		);
		expect(reply).toMatchObject({
			_tag: "failure",
			code: "QUAKE.MEETING.UNAVAILABLE",
		});
		await expect(ipc.handlers.get(CAPTURE_CHUNK)?.({}, {})).rejects.toThrow(
			"Meeting audio chunk rejected",
		);
		await expect(
			ipc.handlers.get(CAPTURE_PCM)?.({}, new Uint8Array()),
		).rejects.toThrow("Meeting PCM rejected");
	} finally {
		await meetings.dispose();
		expect(ipc.handlers.has(CAPTURE_CHUNK)).toBe(false);
		expect(ipc.handlers.has(CAPTURE_PCM)).toBe(false);
		expect(ipc.removeListener).toHaveBeenCalledWith(
			CAPTURE_LOST,
			expect.any(Function),
		);
		await rm(root, { recursive: true, force: true });
	}
});

it("AI-311 SETTINGS-106 reveals only an existing regular managed audio file through production IPC", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-meeting-reveal-"));
	const renderer = "file:///synthetic-meetings/index.html";
	const meetings = registerMeetings({
		userData: root,
		renderer,
		mock: true,
		hardware: () => undefined,
	});
	const frame = {};
	const event = {
		command: true,
		senderFrame: frame,
		sender: { mainFrame: frame, getURL: () => renderer },
	};
	try {
		await meetings.ready;
		const handler = ipc.handlers.get(MEETING_REQUEST);
		if (!handler) throw new Error("Missing production meeting IPC");
		const state = await meetings.runtime.runPromise(
			MeetingService.action("meetingMinutes"),
		);
		const record = state.records[0];
		if (!record) throw new Error("Missing mock record");
		ipc.reveal.mockClear();
		const missing = Schema.decodeUnknownSync(MeetingReply)(
			await handler(event, { _tag: "reveal", id: record.id }),
		);
		expect(missing).toEqual({
			_tag: "failure",
			code: "QUAKE.MEETING.AUDIO_MISSING",
			message: "Audio file not found",
		});
		expect(ipc.reveal).not.toHaveBeenCalled();
		const directory = join(root, "meetings-v1", record.id);
		const audio = join(directory, "final_recording.mp3");
		await mkdir(directory);
		await writeFile(audio, "fake audio", { mode: 0o600 });
		expect(
			Schema.decodeUnknownSync(MeetingReply)(
				await handler(event, { _tag: "reveal", id: record.id }),
			)._tag,
		).toBe("ready");
		expect(ipc.reveal).toHaveBeenCalledExactlyOnceWith(audio);
		await rm(audio);
		const outside = join(root, "outside.mp3");
		await writeFile(outside, "outside audio");
		await symlink(outside, audio);
		expect(
			Schema.decodeUnknownSync(MeetingReply)(
				await handler(event, { _tag: "reveal", id: record.id }),
			)._tag,
		).toBe("failure");
		expect(ipc.reveal).toHaveBeenCalledTimes(1);
		await rm(directory, { recursive: true });
		await symlink(root, directory);
		expect(
			Schema.decodeUnknownSync(MeetingReply)(
				await handler(event, { _tag: "reveal", id: record.id }),
			)._tag,
		).toBe("failure");
		expect(ipc.reveal).toHaveBeenCalledTimes(1);
	} finally {
		await meetings.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it("AI-136 AI-327 binds saved profile credentials and live transport in production registration, including repeat/source-loss cleanup", async () => {
	const { Queue, Redacted } = await import("effect");
	const queue = await Effect.runPromise(Queue.unbounded<unknown>());
	const sent: Record<string, unknown>[] = [];
	let closed = 0;
	const root = await mkdtemp(join(tmpdir(), "oq-production-meeting-"));
	const meetings = registerMeetings({
		userData: root,
		mock: false,
		hardware: () => undefined,
		provider: {
			models: () =>
				Effect.succeed([
					{
						id: "saved-qwen",
						role: "default",
						provider: "qwen",
						model: "qwen3.6-flash",
						baseUrl: "http://127.0.0.1:1234/compatible-mode/v1",
						maxTokens: 2048,
						credentialRef: "00000000-0000-4000-8000-000000000002",
					},
				]),
			credentials: {
				resolve: () => Effect.succeed(Redacted.make("fake-vault")),
				revoked: () => Effect.never,
			},
			socket: {
				connect: (input) =>
					Effect.gen(function* () {
						expect(input.url).toContain(
							"model=qwen3.5-livetranslate-flash-realtime",
						);
						expect(input.headers.Authorization).toBe("Bearer fake-vault");
						return {
							send: (data: string | Uint8Array) =>
								Effect.gen(function* () {
									const event: unknown = JSON.parse(String(data));
									if (typeof event !== "object" || event === null)
										throw new Error("Bad fixture event");
									const obj = Object.fromEntries(Object.entries(event));
									sent.push(obj);
									if (obj.type === "session.update")
										yield* Queue.offer(queue, { type: "session.updated" });
								}),
							receive: Queue.take(queue),
							close: Effect.sync(() => {
								closed++;
							}),
						};
					}),
			},
		},
	});
	let clockOffset = 0;
	const originalNow = Date.now;
	const clock = vi
		.spyOn(Date, "now")
		.mockImplementation(() => originalNow() + clockOffset);
	try {
		const ready = await meetings.ready;
		expect(ready._tag).toBe("Success");
		const first = await meetings.runtime.runPromise(
			MeetingService.action("liveAudioTranslate"),
		);
		expect(first.translating).toBe(true);
		await meetings.runtime.runPromise(
			MeetingService.action("liveAudioTranslate"),
		);
		expect(closed).toBe(0);
		expect(sent.filter((e) => e.type === "session.update")).toHaveLength(1);
		await meetings.runtime.runPromise(
			Queue.offer(queue, {
				type: "response.text.done",
				response_id: "translation",
				text: "fixture live translation",
			}),
		);
		await ipc.handlers.get(CAPTURE_PCM)?.({}, new Uint8Array(14400));
		const updated = await meetings.runtime.runPromise(
			MeetingService.snapshot(),
		);
		expect(updated.translations).toMatchObject([
			{ text: "fixture live translation", final: true },
		]);
		capture.lost("00000000-0000-4000-8000-000000000000");
		await vi.waitFor(async () =>
			expect(
				(await meetings.runtime.runPromise(MeetingService.snapshot()))
					.translating,
			).toBe(false),
		);
		expect(closed).toBe(1);
		clockOffset += 5000;
		expect(
			(
				await meetings.runtime.runPromise(
					MeetingService.action("liveAudioTranslate"),
				)
			).translating,
		).toBe(true);
		clockOffset += 5000;
		expect(
			(
				await meetings.runtime.runPromise(
					MeetingService.action("liveAudioTranslate"),
				)
			).translating,
		).toBe(false);
		expect(closed).toBe(2);
		const current = await meetings.runtime.runPromise(
			MeetingService.snapshot(),
		);
		await meetings.runtime.runPromise(
			MeetingService.configure({ ...current.config, autoGenerate: false }),
		);
		clockOffset += 5000;
		await meetings.runtime.runPromise(
			MeetingService.action("liveAudioTranslate"),
		);
		await meetings.runtime.runPromise(MeetingService.action("meetingMinutes"));
		clockOffset += 5000;
		const ended = await meetings.runtime.runPromise(
			MeetingService.action("meetingMinutes"),
		);
		expect(ended.translating).toBe(false);
		expect(closed).toBe(3);
		expect(
			JSON.stringify(
				Schema.encodeSync(MeetingReply)({ _tag: "ready", snapshot: updated }),
			),
		).not.toContain("fake-vault");
	} finally {
		clock.mockRestore();
		await meetings.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it("restricts remote file IPC to the management window's main frame", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-meeting-file-owner-"));
	const renderer = "file:///synthetic-meetings/index.html";
	let files: ReturnType<typeof vi.spyOn> | undefined;
	const meetings = registerMeetings({
		userData: root,
		renderer,
		mock: true,
		hardware: () => undefined,
		management: () => ({ webContents: { id: 7 } }),
	});
	const frame = { url: renderer };
	const event = (id: number, main = true) => ({
		command: true,
		senderFrame: main ? frame : {},
		sender: { id, mainFrame: frame, getURL: () => renderer },
	});
	const request = {
		_tag: "remoteFiles",
		id: "00000000-0000-4000-8000-000000000111",
		operation: "list",
	};
	try {
		await meetings.ready;
		const service = await meetings.runtime.runPromise(MeetingService);
		files = vi.spyOn(service, "files").mockReturnValue(Effect.succeed([]));
		const handler = ipc.handlers.get(MEETING_REQUEST);
		if (!handler) throw new Error("Missing production meeting IPC");
		for (const source of [event(8), event(7, false)]) {
			expect(await handler(source, request)).toMatchObject({
				_tag: "failure",
				code: "QUAKE.MEETING.INVALID",
			});
		}
		expect(files).not.toHaveBeenCalled();
		expect(await handler(event(7), request)).toEqual({
			_tag: "remoteFiles",
			ids: [],
		});
		expect(files).toHaveBeenCalledOnce();
	} finally {
		files?.mockRestore();
		await meetings.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it("AI-283 authenticates the setup handler and keeps mock install requests away from native dialogs", async () => {
	const root = await mkdtemp(join(tmpdir(), "audio-setup-ipc-"));
	const owner = registerMeetings({
		userData: root,
		mock: true,
		hardware: () => undefined,
		renderer: "https://fixture.invalid",
		management: () => ({ webContents: { id: 42 } }),
	});
	try {
		await owner.ready;
		const setup = ipc.handlers.get("meetings:audio-setup");
		const frame = { url: "https://fixture.invalid" };
		const event = { sender: { id: 42, mainFrame: frame }, senderFrame: frame };
		expect(await setup?.(event, { action: "install" })).toMatchObject({
			state: "mock",
		});
		expect(
			await setup?.(
				{ ...event, sender: { id: 666, mainFrame: frame } },
				{ action: "install" },
			),
		).toMatchObject({ state: "failed" });
		expect(
			await setup?.(event, { action: "exec", path: "/untrusted.pkg" }),
		).toMatchObject({ state: "failed" });
	} finally {
		await owner.dispose();
		await rm(root, { recursive: true, force: true });
	}
	expect(ipc.handlers.has("meetings:audio-setup")).toBe(false);
});
