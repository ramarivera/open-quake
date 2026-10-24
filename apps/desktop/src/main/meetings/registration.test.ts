import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Option } from "effect";
import { beforeEach, expect, it, vi } from "vitest";
import { MeetingService } from "../../../../../packages/edge/src/meetings/meeting-service";
import { CAPTURE_CHUNK } from "../../shared/meeting-bridge";

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
	lost: (_id: string) => {},
	wait: (): Promise<void> => Promise.resolve(),
}));
vi.mock("electron", () => ({
	app: ipc.app,
	ipcMain: ipc,
	BrowserWindow: { getAllWindows: () => [] },
	dialog: {},
	shell: {},
}));
vi.mock("./capture-port", () => ({
	createCapturePort: (options: { onLost: (id: string) => void }) => {
		capture.lost = options.onLost;
		return {
			port: {
				mic: () => Effect.succeed(Option.none()),
				start: (id: string) =>
					Effect.sync(() => {
						capture.id = id;
					}),
				drain: () => Effect.void,
				stop: () => Effect.void,
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
			accepts: () => true,
			active: () => true,
			files: {
				write: () =>
					Effect.promise(async () => {
						capture.written();
						await capture.wait();
					}),
			},
			dispose: () => {},
		};
	},
}));

import { registerMeetings } from "./index";

beforeEach(() => {
	ipc.handlers.clear();
	capture.wait = () => Promise.resolve();
	ipc.handle.mockImplementation(
		(name: string, handler: (...args: unknown[]) => Promise<unknown>) => {
			ipc.handlers.set(name, handler);
		},
	);
	ipc.removeHandler.mockImplementation((name: string) => {
		ipc.handlers.delete(name);
	});
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
