import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Option, Schema } from "effect";
import { beforeEach, expect, it, vi } from "vitest";
import { MeetingStore } from "../../../../../packages/edge/src/meetings/meeting-contracts";
import { MeetingService } from "../../../../../packages/edge/src/meetings/meeting-service";
import {
	CAPTURE_CHUNK,
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
	shell: {},
}));
vi.mock("./capture-port", () => ({
	createCapturePort: (options: { onLost: (id: string) => void }) => {
		capture.created();
		capture.lost = options.onLost;
		return {
			port: {
				mic: () => Effect.succeed(Option.none()),
				start: (id: string) =>
					Effect.sync(() => {
						capture.id = id;
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
		await meetings.dispose();
		expect(capture.disposed).not.toHaveBeenCalled();
		await application.runPromise(MeetingService.action("liveAudioTranslate"));
		expect(
			(await application.runPromise(MeetingService.snapshot())).translating,
		).toBe(true);
		await application.runPromise(MeetingService.shutdown());
		expect(await application.runPromise(Effect.succeed("alive"))).toBe("alive");
		await application.dispose();
		expect(capture.disposed).toHaveBeenCalledOnce();
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
		await rm(root, { recursive: true, force: true });
	}
});
