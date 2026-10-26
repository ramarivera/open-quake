import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { app, BrowserWindow, ipcMain } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAudioOutput } from "../../../../../packages/edge/src/audio/output-service";
import { defaultClockTile, defaultWallpaper } from "../../shared/display";
import {
	WALLPAPER_AUDIO,
	WALLPAPER_CLOCK,
	WALLPAPER_REQUEST,
	WALLPAPER_SNAPSHOT,
	WallpaperReply,
} from "../../shared/wallpaper-contracts";
import { MediaLive, registerMedia } from "./index";
import type { DecodedMedia } from "./media-decoder";
import { MediaRepository } from "./media-repository";

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
		setAudioMuted: vi.fn(),
	};
	isDestroyed = () => false;
	visible = true;
	isVisible = () => this.visible;
}

describe("explicit media registration", () => {
	afterEach(() => {
		app.removeAllListeners();
		vi.unstubAllEnvs();
	});

	it("has no import side effects", () => {
		expect(ipcMain.handle).not.toHaveBeenCalled();
		expect(app.listenerCount("ready")).toBe(0);
	});

	it("keeps two panel snapshots pinned to their serial when management selects another strip", async () => {
		const root = await mkdtemp(join(tmpdir(), "open-quake-two-panels-"));
		const runtime = ManagedRuntime.make(MediaLive(root));
		const a = new TestWindow(),
			b = new TestWindow(),
			management = new TestWindow();
		const windows = [a, b, management];
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValue(
			windows as unknown as BrowserWindow[],
		);
		vi.mocked(BrowserWindow.fromWebContents).mockImplementation(
			(sender) =>
				(windows.find((w) =>
					Object.is(w.webContents, sender),
				) as unknown as BrowserWindow) ?? null,
		);
		const registration = registerMedia(
			runtime,
			() => management as unknown as BrowserWindow,
			"file:///app/index.html",
			false,
			() => a as unknown as BrowserWindow,
			undefined,
			(sender) =>
				Object.is(sender, a.webContents)
					? "A"
					: Object.is(sender, b.webContents)
						? "B"
						: undefined,
		);
		const handler = vi
			.mocked(ipcMain.handle)
			.mock.calls.filter(([channel]) => channel === WALLPAPER_REQUEST)
			.at(-1)?.[1];
		if (!handler) throw new Error("Missing media handler");
		const invoke = (w: TestWindow, input: unknown) =>
			handler(
				{
					sender: w.webContents,
					senderFrame: w.webContents.mainFrame,
				} as unknown as Electron.IpcMainInvokeEvent,
				input,
			);
		try {
			for (const [panel, serial] of [
				[a, "A"],
				[b, "B"],
			] as const)
				expect(await invoke(panel, { _tag: "read" })).toMatchObject({
					_tag: "success",
					snapshot: { saved: { serial } },
				});
			await invoke(management, { _tag: "select", serial: "A" });
			expect(await invoke(b, { _tag: "read" })).toMatchObject({
				snapshot: { saved: { serial: "B" } },
			});
			await invoke(management, { _tag: "select", serial: "B" });
			expect(await invoke(a, { _tag: "read" })).toMatchObject({
				snapshot: { saved: { serial: "A" } },
			});
			const selected = Schema.decodeUnknownSync(WallpaperReply)(
				await invoke(management, { _tag: "read" }),
			);
			if (selected._tag !== "success")
				throw new Error("Missing selected snapshot");
			const failed = {
				_tag: "failed",
				serial: "B",
				revision: selected.snapshot.saved.revision,
				playbackId: selected.snapshot.playbackId,
				index: selected.snapshot.activeIndex,
			};
			expect(await invoke(a, failed)).toMatchObject({ _tag: "failure" });
			expect(await invoke(management, failed)).toMatchObject({
				_tag: "success",
				snapshot: { activeIndex: 1 },
			});
			expect(await invoke(management, failed)).toMatchObject({
				_tag: "failure",
			});
			await invoke(management, {
				_tag: "configure",
				serial: "B",
				revision: 0,
				fillMode: "contain",
				hourFormat: "12h",
			});
			expect(await invoke(b, { _tag: "read" })).toMatchObject({
				snapshot: {
					saved: {
						serial: "B",
						revision: 1,
						settings: { bgFillMode: "contain" },
					},
				},
			});
			for (const [panel, serial] of [
				[a, "A"],
				[b, "B"],
			] as const) {
				const snapshots = panel.webContents.send.mock.calls.filter(
					([channel]) => channel === WALLPAPER_SNAPSHOT,
				);
				expect(snapshots.length).toBeGreaterThan(0);
				expect(
					snapshots.every(([, value]) => value.saved.serial === serial),
				).toBe(true);
			}
			expect(await registration.selectionSerial()).toBe("B");
		} finally {
			await registration.dispose();
			await rm(root, { recursive: true, force: true });
		}
	});

	it.each(["settings change", "panel hide"])(
		"cancels pending audio validation and revokes the active lease on %s",
		async (reason) => {
			vi.stubEnv("OPEN_QUAKE_MOCK_DEVICE", "0");
			const panel = new TestWindow(),
				management = new TestWindow();
			vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
				panel as unknown as BrowserWindow,
			]);
			vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(
				management as unknown as BrowserWindow,
			);
			let enabled = true;
			let entered: () => void = () => {};
			const ready = new Promise<void>((resolve) => {
				entered = resolve;
			});
			let resume: () => void = () => {};
			const blocked = new Promise<void>((resolve) => {
				resume = resolve;
			});
			let media: Effect.Effect<Option.Option<DecodedMedia>> = Effect.promise(
				async () => {
					entered();
					await blocked;
					return Option.none();
				},
			);
			const saved = () => ({
				version: 1 as const,
				serial: "desktop-preview",
				revision: 0,
				clock: defaultClockTile,
				settings: {
					...defaultWallpaper,
					enableSound: enabled,
					displayMediaList: [
						{
							name: "silent.webm",
							type: "video" as const,
							format: "video/webm" as const,
							filePath: `media:${"a".repeat(64)}`,
							duration: 3000,
						},
					],
				},
			});
			const runtime = ManagedRuntime.make(
				Layer.succeed(
					MediaRepository,
					MediaRepository.make({
						load: () =>
							Effect.sync(() => ({ saved: saved(), recovered: false })),
						resolve: () => media,
						save: () => Effect.die("unused"),
						restore: () => Effect.die("unused"),
						importLocal: () => Effect.die("unused"),
						discard: () => Effect.void,
					}),
				),
			);
			const output = await Effect.runPromise(makeAudioOutput);
			const acquire = vi.fn((mute: () => Promise<void>) =>
				Effect.runPromise(output.acquire("wallpaper", Effect.promise(mute))),
			);
			const registration = registerMedia(
				runtime,
				() => management as unknown as BrowserWindow,
				"file:///app/index.html",
				false,
				() => panel as unknown as BrowserWindow,
				acquire,
			);
			const handler = vi
				.mocked(ipcMain.handle)
				.mock.calls.filter((call) => call[0] === WALLPAPER_AUDIO)
				.at(-1)?.[1];
			const request = vi
				.mocked(ipcMain.handle)
				.mock.calls.filter((call) => call[0] === WALLPAPER_REQUEST)
				.at(-1)?.[1];
			if (!handler || !request) throw new Error("missing handlers");
			const event = (window: TestWindow) =>
				({
					sender: window.webContents,
					senderFrame: window.webContents.mainFrame,
				}) as unknown as Electron.IpcMainInvokeEvent;
			const command = {
				id: "a",
				serial: "desktop-preview",
				revision: 0,
				active: true,
			};
			try {
				expect(await handler(event(management), command)).toBe(false);
				const start = handler(event(panel), command);
				await ready;
				if (reason === "panel hide") {
					panel.visible = false;
					panel.emit("hide");
				} else await handler(event(panel), { ...command, active: false });
				resume();
				expect(await start).toBe(false);
				expect(acquire).not.toHaveBeenCalled();
				panel.visible = true;
				media = Effect.succeed(
					Option.some({
						format: "video/webm",
						dataUrl: "data:video/webm;base64,YQ==",
						width: 320,
						height: 80,
						durationMs: 3000,
					}),
				);
				expect(await handler(event(panel), { ...command, id: "b" })).toBe(true);
				expect(panel.webContents.setAudioMuted).toHaveBeenLastCalledWith(false);
				if (reason === "panel hide") {
					panel.visible = false;
					panel.emit("hide");
				} else enabled = false;
				await request(event(management), { _tag: "read" });
				expect(panel.webContents.setAudioMuted).toHaveBeenLastCalledWith(true);
				if (reason === "panel hide") {
					expect(
						await handler(event(panel), { ...command, id: "hidden" }),
					).toBe(false);
					expect(acquire).toHaveBeenCalledTimes(1);
				}
			} finally {
				resume();
				await registration.dispose();
				await Effect.runPromise(output.close());
			}
		},
	);

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
			true,
			() => panel as unknown as BrowserWindow,
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
			Object.defineProperty(panel, "webContents", {
				get: () => {
					throw new Error("Object has been destroyed");
				},
			});
			expect(() => panel.emit("closed")).not.toThrow();
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
