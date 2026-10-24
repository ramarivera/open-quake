import type {
	BrowserWindowConstructorOptions,
	Display,
	Rectangle,
} from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerMedia } from "./media";
import { desktopProfilesLive, registerProfiles } from "./profiles/profile-ipc";
import { makeDisplay } from "./test/display";
import { report } from "./test/hid";

const native = vi.hoisted(() => ({
	layer: undefined as Layer.Layer<HidTransport> | undefined,
}));
vi.mock("@open-quake/device/node-hid", () => ({
	get NodeHidLive() {
		if (!native.layer)
			throw new Error("Tests must inject the fake HID transport");
		return native.layer;
	},
}));

const electron = vi.hoisted(() => {
	class Window {
		static windows: Window[] = [];
		static getAllWindows() {
			return Window.windows.filter((window) => !window.destroyed);
		}

		destroyed = false;
		webContents = { send: vi.fn(), isDestroyed: () => this.destroyed };
		loadURL = vi.fn();
		loadFile = vi.fn();
		setBounds = vi.fn<(bounds: Rectangle) => void>();
		setAlwaysOnTop = vi.fn<(flag: boolean, level?: string) => void>();
		destroy = vi.fn(() => {
			this.destroyed = true;
		});
		on =
			vi.fn<
				(
					event: string,
					listener: (event: { preventDefault(): void }) => void,
				) => void
			>();

		constructor(readonly options: BrowserWindowConstructorOptions) {
			Window.windows.push(this);
		}

		isDestroyed() {
			return this.destroyed;
		}
	}
	return {
		BrowserWindow: Window,
		app: {
			whenReady: vi.fn(() => Promise.resolve()),
			getPath: vi.fn(() => "/tmp/open-quake-window-test"),
			on: vi.fn<
				(
					event: string,
					listener: (event: { preventDefault(): void }) => void,
				) => void
			>(),
			quit: vi.fn(),
		},
		ipcMain: { on: vi.fn(), removeListener: vi.fn() },
		screen: {
			getAllDisplays: vi.fn<() => Display[]>(),
			getPrimaryDisplay: vi.fn<() => Display>(),
			on: vi.fn<(event: string, listener: () => void) => void>(),
			removeListener: vi.fn<(event: string, listener: () => void) => void>(),
		},
	};
});

vi.mock("electron", () => electron);
vi.mock("./knob", () => ({
	registerKnob: () => ({
		onDevice: () => {},
		refresh: () => Promise.resolve(),
		dispose: () => Promise.resolve(),
	}),
}));
vi.mock("./media", async () => {
	const { Layer } = await import("effect");
	return { MediaLive: vi.fn(() => Layer.empty), registerMedia: vi.fn() };
});
vi.mock("./profiles/profile-ipc", async () => {
	const actual = await vi.importActual<typeof import("./profiles/profile-ipc")>(
		"./profiles/profile-ipc",
	);
	const { createInitialProfileEnvelope, encodeProfileEnvelope } = await import(
		"../../../../packages/device/src/profiles/profile-contracts.js"
	);
	return {
		desktopProfilesLive: vi.fn(() =>
			actual.ProfilesLive({
				read: async () => encodeProfileEnvelope(createInitialProfileEnvelope()),
				write: async () => undefined,
			}),
		),
		registerProfiles: vi.fn(),
	};
});

function displayEvent(name: string): void {
	const listener = electron.screen.on.mock.calls.find(
		([event]) => event === name,
	)?.[1];
	expect(listener).toBeDefined();
	listener?.();
}

function appEvent(name: string) {
	const listener = electron.app.on.mock.calls.find(
		([event]) => event === name,
	)?.[1];
	expect(listener).toBeDefined();
	const event = { preventDefault: vi.fn() };
	listener?.(event);
	return event;
}

function windows() {
	const [panel, management] = electron.BrowserWindow.windows;
	if (!panel || !management) throw new Error("Both windows must be created");
	return { panel, management };
}

describe("desktop window lifecycle", () => {
	const primary = makeDisplay();
	// macOS reports the strip's native portrait framebuffer, left of the primary.
	const panelDisplay = makeDisplay({
		id: 2,
		label: "DK-QUAKE",
		size: { width: 480, height: 1920 },
		bounds: { x: -480, y: 0, width: 480, height: 1920 },
		workArea: { x: -480, y: 25, width: 480, height: 1895 },
	});

	beforeEach(async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173");
		vi.stubEnv("OPEN_QUAKE_MOCK_DEVICE", "1");
		native.layer = (await Effect.runPromise(makeFakeHidTransport())).layer;
		electron.BrowserWindow.windows = [];
		electron.screen.getAllDisplays.mockReturnValue([primary]);
		electron.screen.getPrimaryDisplay.mockReturnValue(primary);
		await import("./index");
		await vi.waitFor(() =>
			expect(vi.getTimerCount()).toBeGreaterThanOrEqual(3),
		);
	});

	afterEach(async () => {
		appEvent("before-quit");
		await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	it("starts both surfaces on the primary display without panel hardware", () => {
		const { panel, management } = windows();
		expect(registerMedia).toHaveBeenCalledOnce();
		expect(vi.mocked(registerMedia).mock.calls[0]?.[1]()).toBe(management);
		expect(registerProfiles).toHaveBeenCalledOnce();
		expect(desktopProfilesLive).toHaveBeenCalledOnce();
		expect(panel.options).toMatchObject({
			x: 0,
			y: 0,
			width: 1920,
			height: 480,
			title: "open-quake panel",
			frame: false,
		});
		expect(management.options.frame).not.toBe(false);
		for (const window of [panel, management]) {
			expect(window.webContents.send).toHaveBeenCalledWith("quake:event", {
				source: "mock",
				kind: "status",
				state: "connected",
			});
		}
		vi.advanceTimersByTime(1500);
		for (const window of [panel, management]) {
			expect(window.webContents.send).toHaveBeenCalledWith("quake:event", {
				source: "mock",
				kind: "rotate",
				direction: expect.toBeOneOf([1, -1]),
			});
		}
	});

	it("replays connected mock status when either preload requests it", () => {
		const handler = electron.ipcMain.on.mock.calls.find(
			([channel]) => channel === "quake:status",
		)?.[1];
		expect(handler).toBeDefined();
		for (const window of Object.values(windows())) {
			window.webContents.send.mockClear();
			handler?.({ sender: window.webContents });
			expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(
				"quake:event",
				{ source: "mock", kind: "status", state: "connected" },
			);
		}
	});

	it("swaps to a strip panel when DK-QUAKE is attached, then back to a normal fallback", () => {
		const { panel: fallback } = windows();
		// A normal window on the current Space, never rotated.
		expect(fallback.options.type).toBeUndefined();
		expect(fallback.setAlwaysOnTop).toHaveBeenLastCalledWith(
			false,
			"screen-saver",
		);
		expect(fallback.loadURL).toHaveBeenLastCalledWith(
			"http://localhost:5173?surface=panel&rotation=0",
		);
		electron.screen.getAllDisplays.mockReturnValue([primary, panelDisplay]);
		displayEvent("display-added");
		const strip = electron.BrowserWindow.windows.at(-1);
		expect(strip).not.toBe(fallback);
		expect(fallback.destroy).toHaveBeenCalledOnce();
		expect(strip?.options.type).toBe(
			process.platform === "darwin" ? "panel" : undefined,
		);
		// The whole display, menu-bar area included, with the canvas turned upright.
		expect(strip?.setBounds).toHaveBeenLastCalledWith(panelDisplay.bounds);
		expect(strip?.setAlwaysOnTop).toHaveBeenLastCalledWith(
			true,
			"screen-saver",
		);
		expect(strip?.loadURL).toHaveBeenLastCalledWith(
			"http://localhost:5173?surface=panel&rotation=90",
		);
		electron.screen.getAllDisplays.mockReturnValue([primary]);
		displayEvent("display-removed");
		const restored = electron.BrowserWindow.windows.at(-1);
		expect(strip?.destroy).toHaveBeenCalledOnce();
		expect(restored?.options.type).toBeUndefined();
		expect(restored?.setBounds).toHaveBeenLastCalledWith({
			x: 0,
			y: 0,
			width: 1920,
			height: 480,
		});
		expect(restored?.loadURL).toHaveBeenLastCalledWith(
			"http://localhost:5173?surface=panel&rotation=0",
		);
		expect(electron.BrowserWindow.getAllWindows()).toHaveLength(2);
	});

	it("recreates a destroyed panel on hot-plug and forwards to the replacement", () => {
		const { panel, management } = windows();
		panel.webContents.send.mockClear();
		management.webContents.send.mockClear();
		panel.destroyed = true;
		electron.screen.getAllDisplays.mockReturnValue([primary, panelDisplay]);
		displayEvent("display-added");
		const replacement = electron.BrowserWindow.windows.at(-1);
		expect(replacement?.options).toMatchObject({
			...panelDisplay.bounds,
			title: "open-quake panel",
		});
		expect(replacement?.loadURL).toHaveBeenCalledWith(
			"http://localhost:5173?surface=panel&rotation=90",
		);
		vi.advanceTimersByTime(1500);
		expect(panel.webContents.send).not.toHaveBeenCalled();
		expect(replacement?.webContents.send).toHaveBeenCalledTimes(1);
		expect(management.webContents.send).toHaveBeenCalledTimes(1);
	});

	it("follows display moves and reloads only when the strip's rotation changes", () => {
		electron.screen.getAllDisplays.mockReturnValue([primary, panelDisplay]);
		displayEvent("display-added");
		const panel = electron.BrowserWindow.windows.at(-1);
		if (!panel) throw new Error("The strip panel must exist");
		const loads = panel.loadURL.mock.calls.length;
		const moved = makeDisplay({
			...panelDisplay,
			bounds: { x: 2560, y: 0, width: 480, height: 1920 },
		});
		electron.screen.getAllDisplays.mockReturnValue([primary, moved]);
		displayEvent("display-metrics-changed");
		expect(panel.setBounds).toHaveBeenLastCalledWith(moved.bounds);
		expect(panel.loadURL).toHaveBeenCalledTimes(loads);
		// Rotated in System Settings: macOS now reports a landscape strip.
		const rotated = makeDisplay({
			...panelDisplay,
			size: { width: 1920, height: 480 },
			bounds: { x: -1920, y: 0, width: 1920, height: 480 },
			rotation: 90,
		});
		electron.screen.getAllDisplays.mockReturnValue([primary, rotated]);
		displayEvent("display-metrics-changed");
		expect(panel.setBounds).toHaveBeenLastCalledWith(rotated.bounds);
		expect(panel.loadURL).toHaveBeenLastCalledWith(
			"http://localhost:5173?surface=panel&rotation=0",
		);
	});

	it("prevents page title changes so the OmniWM panel title stays stable", () => {
		const { panel } = windows();
		const preventDefault = vi.fn();
		const listener = panel.on.mock.calls.find(
			([event]) => event === "page-title-updated",
		)?.[1];
		expect(listener).toBeDefined();
		listener?.({ preventDefault });
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(panel.options.title).toBe("open-quake panel");
	});

	it("restores both windows on macOS activation and forwards to the new windows", () => {
		const { panel, management } = windows();
		panel.webContents.send.mockClear();
		management.webContents.send.mockClear();
		panel.destroyed = true;
		management.destroyed = true;
		appEvent("activate");
		expect(vi.mocked(registerMedia).mock.calls[0]?.[1]()).toBe(
			electron.BrowserWindow.windows.at(-1),
		);
		vi.advanceTimersByTime(1500);
		expect(electron.BrowserWindow.getAllWindows()).toHaveLength(2);
		for (const window of electron.BrowserWindow.getAllWindows()) {
			expect(window.webContents.send).toHaveBeenCalledTimes(1);
		}
		expect(panel.webContents.send).not.toHaveBeenCalled();
		expect(management.webContents.send).not.toHaveBeenCalled();
	});

	it("unregisters display callbacks and stops the bus before quitting", async () => {
		appEvent("before-quit");
		await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
		for (const [event, listener] of electron.screen.on.mock.calls) {
			expect(electron.screen.removeListener).toHaveBeenCalledWith(
				event,
				listener,
			);
		}
		expect(vi.getTimerCount()).toBe(0);
	});
});

import type { HidTransport } from "@open-quake/device";
import {
	type FakeHidTransport,
	makeFakeHidTransport,
} from "@open-quake/device/fake";
import { Deferred, Effect, type Layer } from "effect";

describe("desktop main with the real device service and fake HID", () => {
	let fake: FakeHidTransport;

	beforeEach(async () => {
		vi.resetModules();
		vi.stubEnv("OPEN_QUAKE_MOCK_DEVICE", "");
		vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173");
		fake = await Effect.runPromise(makeFakeHidTransport());
		native.layer = fake.layer;
		electron.BrowserWindow.windows = [];
		const display = makeDisplay();
		electron.screen.getAllDisplays.mockReturnValue([display]);
		electron.screen.getPrimaryDisplay.mockReturnValue(display);
	});

	afterEach(async () => {
		appEvent("before-quit");
		await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
		vi.unstubAllEnvs();
	});

	async function start(): Promise<void> {
		await import("./index");
		await vi.waitFor(() =>
			expect(windows().panel.webContents.send).toHaveBeenCalledWith(
				"quake:event",
				{ source: "hid", kind: "status", state: "connected" },
			),
		);
	}

	it("defaults to HID, forwards to both windows, cleans up unplug and reconnects", async () => {
		await start();
		const { panel, management } = windows();
		await Effect.runPromise(fake.emit(report(3, 1, [1])));
		for (const window of [panel, management])
			await vi.waitFor(() =>
				expect(window.webContents.send).toHaveBeenCalledWith("quake:event", {
					source: "hid",
					kind: "rotate",
					direction: 1,
				}),
			);
		await Effect.runPromise(
			fake.failRead(new Error("token=private-native-cause")),
		);
		await vi.waitFor(() =>
			expect(panel.webContents.send).toHaveBeenCalledWith("quake:event", {
				source: "hid",
				kind: "status",
				state: "error",
				error: {
					_tag: "QuakeHidReadFailed",
					code: "QUAKE.HID.READ_FAILED",
					category: "dependency",
				},
			}),
		);
		expect(await Effect.runPromise(fake.closes)).toBe(1);
		await vi.waitFor(
			async () => expect(await Effect.runPromise(fake.opens)).toBe(2),
			{ timeout: 3000 },
		);
		await Effect.runPromise(fake.emit(report(3, 2, [1])));
		for (const window of [panel, management])
			await vi.waitFor(() =>
				expect(window.webContents.send).toHaveBeenCalledWith("quake:event", {
					source: "hid",
					kind: "press",
					state: 1,
				}),
			);
		expect(
			panel.webContents.send.mock.calls.every(
				([, event]) => event.source === "hid",
			),
		).toBe(true);
		expect(JSON.stringify(panel.webContents.send.mock.calls)).not.toContain(
			"private-native-cause",
		);
		appEvent("before-quit");
		await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
		expect(await Effect.runPromise(fake.closes)).toBe(2);
	});

	it("keeps one handle for the remaining window, releases it when all windows close, and reacquires on activation", async () => {
		await start();
		const { panel, management } = windows();
		panel.destroyed = true;
		await Effect.runPromise(fake.emit(report(3, 2, [1])));
		await vi.waitFor(() =>
			expect(management.webContents.send).toHaveBeenCalledWith("quake:event", {
				source: "hid",
				kind: "press",
				state: 1,
			}),
		);
		expect(await Effect.runPromise(fake.closes)).toBe(0);
		management.destroyed = true;
		appEvent("window-all-closed");
		await vi.waitFor(async () =>
			expect(await Effect.runPromise(fake.closes)).toBe(1),
		);
		appEvent("activate");
		await vi.waitFor(async () =>
			expect(await Effect.runPromise(fake.opens)).toBe(2),
		);
		await Effect.runPromise(fake.emit(report(3, 1, [0])));
		for (const window of electron.BrowserWindow.getAllWindows())
			await vi.waitFor(() =>
				expect(window.webContents.send).toHaveBeenCalledWith("quake:event", {
					source: "hid",
					kind: "rotate",
					direction: -1,
				}),
			);
	});

	it("replays status after preload subscribes or reloads", async () => {
		await start();
		const { panel } = windows();
		panel.webContents.send.mockClear();
		const handler = electron.ipcMain.on.mock.calls.find(
			([channel]) => channel === "quake:status",
		)?.[1];
		expect(handler).toBeDefined();
		handler?.({ sender: panel.webContents });
		expect(panel.webContents.send).toHaveBeenCalledExactlyOnceWith(
			"quake:event",
			{ source: "hid", kind: "status", state: "connected" },
		);
	});

	it("holds quit and rapid window reactivation until native close finishes", async () => {
		const closing = await Effect.runPromise(Deferred.make<void>());
		const allowClose = await Effect.runPromise(Deferred.make<void>());
		const { Layer: Layers } = await import("effect");
		const { HidTransport: Transport } = await import("@open-quake/device");
		native.layer = Layers.succeed(Transport, {
			...fake.transport,
			open: (info) =>
				Effect.map(fake.transport.open(info), (handle) => ({
					...handle,
					close: () =>
						Deferred.succeed(closing, undefined).pipe(
							Effect.zipRight(Deferred.await(allowClose)),
							Effect.zipRight(handle.close()),
						),
				})),
		});
		await start();
		for (const window of electron.BrowserWindow.getAllWindows())
			window.destroyed = true;
		appEvent("window-all-closed");
		appEvent("activate");
		await Effect.runPromise(Deferred.await(closing));
		expect(await Effect.runPromise(fake.opens)).toBe(1);
		const event = appEvent("before-quit");
		expect(event.preventDefault).toHaveBeenCalledOnce();
		// Repeated quit requests must still wait for the same cleanup.
		expect(appEvent("before-quit").preventDefault).toHaveBeenCalledOnce();
		electron.app.quit.mockClear();
		expect(await Effect.runPromise(fake.closes)).toBe(0);
		await Effect.runPromise(Deferred.succeed(allowClose, undefined));
		await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalledOnce());
		expect(await Effect.runPromise(fake.closes)).toBe(1);
		expect(await Effect.runPromise(fake.opens)).toBe(1);
		expect(appEvent("before-quit").preventDefault).not.toHaveBeenCalled();
	});
});
