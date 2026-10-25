import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetingId } from "../../../../../packages/edge/src/meetings/meeting-contracts";
import { defaultMeetingConfig } from "../../../../../packages/edge/src/meetings/meeting-defaults";

const native = vi.hoisted(() => {
	class Events {
		listeners = new Map<string, ((...args: unknown[]) => void)[]>();
		on = vi.fn((name: string, callback: (...args: unknown[]) => void) => {
			this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]);
			return this;
		});
		once = this.on;
		removeListener = vi.fn(
			(name: string, callback: (...args: unknown[]) => void) => {
				this.listeners.set(
					name,
					(this.listeners.get(name) ?? []).filter((fn) => fn !== callback),
				);
			},
		);
		emit(name: string, ...args: unknown[]) {
			for (const fn of this.listeners.get(name) ?? []) fn(...args);
		}
	}
	const ipc = new Events();
	const app = new Events();
	class Window extends Events {
		static windows: Window[] = [];
		static getAllWindows = () => Window.windows.filter((win) => !win.destroyed);
		destroyed = false;
		url = "";
		frame = { url: "" };
		webContents = Object.assign(new Events(), {
			getURL: () => this.url,
			mainFrame: this.frame,
			setWindowOpenHandler: vi.fn(),
			session: {
				setPermissionCheckHandler: vi.fn(),
				setPermissionRequestHandler: vi.fn(),
				setDisplayMediaRequestHandler: vi.fn(),
			},
			send: vi.fn((channel: string, value: { requestId: string }) => {
				if (channel === "meetings:capture")
					queueMicrotask(() =>
						ipc.emit(
							"meetings:capture-reply",
							{ sender: this.webContents, senderFrame: this.frame },
							{ requestId: value.requestId, success: true },
						),
					);
			}),
		});
		constructor() {
			super();
			Window.windows.push(this);
			app.emit("browser-window-created", {}, this);
		}
		isDestroyed = () => this.destroyed;
		destroy = vi.fn(() => {
			this.destroyed = true;
			this.emit("closed");
		});
		loadURL = vi.fn(async (url: string) => {
			this.url = url;
			this.frame.url = url;
			ipc.emit("meetings:capture-ready", {
				sender: this.webContents,
				senderFrame: this.frame,
			});
		});
	}
	return { app, ipc, Window, converterReady: vi.fn() };
});
vi.mock("electron", () => ({
	app: native.app,
	ipcMain: native.ipc,
	BrowserWindow: native.Window,
	systemPreferences: {
		askForMediaAccess: async () => true,
		getMediaAccessStatus: () => "granted",
	},
	desktopCapturer: { getSources: async () => [{ id: "fake" }] },
}));
vi.mock("./audio-files", () => ({
	audioFiles: () => ({
		ready: () => native.converterReady() ?? Effect.void,
		finalize: () => Effect.void,
		duration: () => Effect.succeed(2500),
	}),
}));

import { meetingError } from "../../../../../packages/edge/src/meetings/meeting-errors";
import { createCapturePort } from "./capture-port";

const ports: ReturnType<typeof createCapturePort>[] = [];
const setup = () => {
	const onLost = vi.fn();
	const onNoWindows = vi.fn();
	const capture = createCapturePort({
		root: "unused",
		renderer: "file:///app/index.html",
		ffmpeg: "unused",
		hardware: () => undefined,
		mock: false,
		onLost,
		onNoWindows,
	});
	ports.push(capture);
	return { capture, onLost, onNoWindows };
};
afterEach(() => {
	for (const capture of ports.splice(0)) capture.dispose();
	native.Window.windows = [];
	native.converterReady.mockReset();
});
describe("capture host ownership and authority", () => {
	it("rejects recording before creating a capture window when FFmpeg is unavailable", async () => {
		const { capture } = setup();
		native.converterReady.mockReturnValue(
			Effect.fail(meetingError("ConverterUnavailable")),
		);
		const result = await Effect.runPromise(
			Effect.either(
				capture.port.start(
					MeetingId.make(crypto.randomUUID()),
					defaultMeetingConfig,
					undefined,
				),
			),
		);
		expect(result).toMatchObject({
			_tag: "Left",
			left: { code: "QUAKE.MEETING.CONVERTER_UNAVAILABLE" },
		});
		expect(native.Window.windows).toHaveLength(0);
	});

	it("reports standalone translation loss on crash and releases its hidden host", async () => {
		const { capture, onLost } = setup();
		await Effect.runPromise(
			capture.port.startTranslation(defaultMeetingConfig),
		);
		const host = native.Window.windows.at(-1);
		host?.webContents.emit("render-process-gone");
		expect(onLost).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000000");
		expect(host?.destroyed).toBe(true);
	});
	it("denies media and IPC after document navigation and from child frames", async () => {
		const { capture } = setup();
		await Effect.runPromise(
			capture.port.startTranslation(defaultMeetingConfig),
		);
		const host = native.Window.windows.at(-1);
		if (!host) throw new Error("Missing host");
		const check =
			host.webContents.session.setPermissionCheckHandler.mock.calls.at(-1)?.[0];
		const request =
			host.webContents.session.setPermissionRequestHandler.mock.calls.at(
				-1,
			)?.[0];
		if (typeof check !== "function" || typeof request !== "function")
			throw new Error("Missing permissions");
		const details = {
			isMainFrame: true,
			requestingUrl: host.url,
			mediaType: "audio",
		};
		expect(check(host.webContents, "media", "file://", details)).toBe(true);
		expect(
			check(host.webContents, "media", "file://", {
				...details,
				isMainFrame: false,
			}),
		).toBe(false);
		host.url = "https://untrusted.invalid/";
		host.frame.url = host.url;
		expect(
			check(host.webContents, "media", "https://untrusted.invalid", {
				...details,
				requestingUrl: host.url,
			}),
		).toBe(false);
		const grant = vi.fn();
		request(host.webContents, "media", grant, {
			...details,
			requestingUrl: host.url,
		});
		expect(grant).toHaveBeenCalledWith(false);
		expect(
			Reflect.apply(capture.accepts, undefined, [
				{ sender: host.webContents, senderFrame: host.frame },
			]),
		).toBe(false);
	});
	it("destroys idle capture hosts and permits a fresh host for subsequent recording", async () => {
		const { capture } = setup();
		const id = MeetingId.make(crypto.randomUUID());
		await Effect.runPromise(
			capture.port.start(id, defaultMeetingConfig, undefined),
		);
		const host = native.Window.windows.at(-1);
		await Effect.runPromise(capture.port.stop(id));
		expect(host?.destroyed).toBe(true);
		await Effect.runPromise(
			capture.port.start(id, defaultMeetingConfig, undefined),
		);
		expect(native.Window.windows.at(-1)).not.toBe(host);
		await Effect.runPromise(capture.port.cancel(id));
		expect(native.Window.getAllWindows()).toHaveLength(0);
	});
	it("notifies the owner when the last user window closes while capture remains", async () => {
		const user = new native.Window();
		const { capture, onNoWindows } = setup();
		await Effect.runPromise(
			capture.port.startTranslation(defaultMeetingConfig),
		);
		user.destroy();
		expect(onNoWindows).toHaveBeenCalledOnce();
	});
});
