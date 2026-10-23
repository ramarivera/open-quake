import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { app, BrowserWindow, ipcMain } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	WALLPAPER_CLOCK,
	WALLPAPER_REQUEST,
} from "../../shared/wallpaper-contracts";
import { MediaLive, registerMedia } from "./index";

vi.mock("electron", async () => {
	const { EventEmitter } = await import("node:events");
	return {
		app: Object.assign(new EventEmitter(), { quit: vi.fn() }),
		BrowserWindow: { getAllWindows: vi.fn(() => []), fromWebContents: vi.fn() },
		ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
		dialog: { showOpenDialog: vi.fn() },
		nativeImage: { createFromBuffer: vi.fn() },
	};
});

class TestWindow extends EventEmitter {
	readonly webContents = {
		mainFrame: {},
		getURL: () => "file:///app/index.html?surface=management",
		isDestroyed: () => false,
		send: vi.fn(),
	};
	isDestroyed = () => false;
}

describe("explicit media registration", () => {
	afterEach(() => {
		app.removeAllListeners();
	});

	it("has no import side effects", () => {
		expect(ipcMain.handle).not.toHaveBeenCalled();
		expect(app.listenerCount("ready")).toBe(0);
	});

	it("authorizes by window identity and disposes its injected runtime before quitting", async () => {
		const root = await mkdtemp(join(tmpdir(), "open-quake-registration-"));
		let finalized = false;
		const runtime = ManagedRuntime.make(
			Layer.merge(
				MediaLive(root),
				Layer.scopedDiscard(
					Effect.addFinalizer(() =>
						Effect.sync(() => {
							finalized = true;
						}),
					),
				),
			),
		);
		const runPromise = vi.spyOn(runtime, "runPromise");
		const runFork = vi.spyOn(runtime, "runFork");
		const panel = new TestWindow();
		let management = new TestWindow();
		let windows = [panel, management];
		vi.mocked(BrowserWindow.getAllWindows).mockImplementation(
			() => windows as unknown as BrowserWindow[],
		);
		vi.mocked(BrowserWindow.fromWebContents).mockImplementation(
			(sender) =>
				(windows.find((window) =>
					Object.is(window.webContents, sender),
				) as unknown as BrowserWindow) ?? null,
		);
		const registration = registerMedia(
			runtime,
			() => management as unknown as BrowserWindow,
			"file:///app/index.html",
		);
		try {
			const handler = vi
				.mocked(ipcMain.handle)
				.mock.calls.find((call) => call[0] === WALLPAPER_REQUEST)?.[1];
			if (!handler) throw new Error("Media handler was not registered");
			const invoke = (window: TestWindow, input: unknown, mainFrame = true) =>
				handler(
					{
						sender: window.webContents,
						senderFrame: mainFrame ? window.webContents.mainFrame : {},
					} as unknown as Electron.IpcMainInvokeEvent,
					input,
				);
			for (const tag of ["select", "import", "configure", "clear", "restore"])
				expect(
					await invoke(panel, { _tag: tag, serial: "spoofed" }),
				).toMatchObject({
					_tag: "failure",
					code: "QUAKE.DISPLAY.INVALID_WALLPAPER",
				});
			expect(
				await invoke(management, { _tag: "select", serial: "management" }),
			).toMatchObject({
				_tag: "success",
				snapshot: { saved: { serial: "management" } },
			});
			expect(await invoke(panel, { _tag: "read" })).toMatchObject({
				_tag: "success",
				snapshot: { saved: { serial: "management" } },
			});
			expect(await invoke(management, { _tag: "read" }, false)).toMatchObject({
				_tag: "failure",
			});
			await vi.waitFor(() => expect(runFork).toHaveBeenCalledTimes(1));
			const promisesBeforeClose = runPromise.mock.calls.length;
			windows = [];
			panel.emit("closed");
			management.emit("closed");
			expect(runPromise.mock.calls.length).toBe(promisesBeforeClose + 1);
			const oldManagement = management;
			management = new TestWindow();
			windows = [management, oldManagement];
			app.emit("browser-window-created", {}, management);
			expect(
				await invoke(oldManagement, { _tag: "select", serial: "stale" }),
			).toMatchObject({ _tag: "failure" });
			expect(
				await invoke(management, { _tag: "select", serial: "new-management" }),
			).toMatchObject({ _tag: "success" });
			await vi.waitFor(() => expect(runFork).toHaveBeenCalledTimes(2));
			const event = { preventDefault: vi.fn() };
			app.emit("before-quit", event);
			expect(event.preventDefault).toHaveBeenCalledOnce();
			expect(app.quit).not.toHaveBeenCalled();
			await registration.dispose();
			await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce());
			expect(finalized).toBe(true);
			expect(ipcMain.removeHandler).toHaveBeenCalledWith(WALLPAPER_REQUEST);
			expect(app.listenerCount("browser-window-created")).toBe(0);
			expect(app.listenerCount("before-quit")).toBe(0);
			const sends = management.webContents.send.mock.calls.filter(
				(call) => call[0] === WALLPAPER_CLOCK,
			).length;
			await new Promise<void>((resolve) => setTimeout(resolve, 1100));
			expect(
				management.webContents.send.mock.calls.filter(
					(call) => call[0] === WALLPAPER_CLOCK,
				),
			).toHaveLength(sends);
		} finally {
			await registration.dispose();
			await rm(root, { recursive: true, force: true });
		}
	});
});
