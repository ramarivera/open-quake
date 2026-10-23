import type {
	BrowserWindowConstructorOptions,
	Display,
	Rectangle,
} from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerMedia } from "./media";
import { makeDisplay } from "./test/display";

const electron = vi.hoisted(() => {
	class Window {
		static windows: Window[] = [];
		static getAllWindows() {
			return Window.windows.filter((window) => !window.destroyed);
		}

		destroyed = false;
		webContents = { send: vi.fn() };
		loadURL = vi.fn();
		loadFile = vi.fn();
		setBounds = vi.fn<(bounds: Rectangle) => void>();
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
			on: vi.fn<(event: string, listener: () => void) => void>(),
			quit: vi.fn(),
		},
		screen: {
			getAllDisplays: vi.fn<() => Display[]>(),
			getPrimaryDisplay: vi.fn<() => Display>(),
			on: vi.fn<(event: string, listener: () => void) => void>(),
			removeListener: vi.fn<(event: string, listener: () => void) => void>(),
		},
	};
});

vi.mock("electron", () => electron);
vi.mock("./media", async () => {
	const { Layer } = await import("effect");
	return { MediaLive: vi.fn(() => Layer.empty), registerMedia: vi.fn() };
});

function displayEvent(name: string): void {
	const listener = electron.screen.on.mock.calls.find(
		([event]) => event === name,
	)?.[1];
	expect(listener).toBeDefined();
	listener?.();
}

function appEvent(name: string): void {
	const listener = electron.app.on.mock.calls.find(
		([event]) => event === name,
	)?.[1];
	expect(listener).toBeDefined();
	listener?.();
}

function windows() {
	const [panel, management] = electron.BrowserWindow.windows;
	if (!panel || !management) throw new Error("Both windows must be created");
	return { panel, management };
}

describe("desktop window lifecycle", () => {
	const primary = makeDisplay();
	const panelDisplay = makeDisplay({
		id: 2,
		label: "DK-QUAKE",
		size: { width: 1920, height: 480 },
		workArea: { x: 2560, y: -480, width: 1920, height: 480 },
	});

	beforeEach(async () => {
		vi.resetModules();
		vi.useFakeTimers();
		electron.BrowserWindow.windows = [];
		electron.screen.getAllDisplays.mockReturnValue([primary]);
		electron.screen.getPrimaryDisplay.mockReturnValue(primary);
		await import("./index");
	});

	afterEach(() => {
		appEvent("before-quit");
		vi.useRealTimers();
	});

	it("starts both surfaces on the primary display without panel hardware", () => {
		const { panel, management } = windows();
		expect(registerMedia).toHaveBeenCalledOnce();
		expect(vi.mocked(registerMedia).mock.calls[0]?.[1]()).toBe(management);
		expect(panel.options).toMatchObject({
			x: 0,
			y: 0,
			width: 1920,
			height: 480,
			title: "open-quake panel",
			frame: false,
		});
		expect(management.options.frame).not.toBe(false);
		vi.advanceTimersByTime(1500);
		for (const window of [panel, management]) {
			expect(window.webContents.send).toHaveBeenCalledWith("quake:event", {
				source: "mock",
				kind: "rotate",
				direction: expect.toBeOneOf([1, -1]),
			});
		}
	});

	it("moves the existing panel when DK-QUAKE is attached, then falls back on removal", () => {
		const { panel } = windows();
		electron.screen.getAllDisplays.mockReturnValue([primary, panelDisplay]);
		displayEvent("display-added");
		expect(panel.setBounds).toHaveBeenLastCalledWith(panelDisplay.workArea);
		electron.screen.getAllDisplays.mockReturnValue([primary]);
		displayEvent("display-removed");
		expect(panel.setBounds).toHaveBeenLastCalledWith({
			x: 0,
			y: 0,
			width: 1920,
			height: 480,
		});
		expect(electron.BrowserWindow.windows).toHaveLength(2);
	});

	it("recreates a destroyed panel on hot-plug and forwards to the replacement", () => {
		const { panel, management } = windows();
		panel.destroyed = true;
		electron.screen.getAllDisplays.mockReturnValue([primary, panelDisplay]);
		displayEvent("display-added");
		const replacement = electron.BrowserWindow.windows.at(-1);
		expect(replacement?.options).toMatchObject({
			...panelDisplay.workArea,
			title: "open-quake panel",
		});
		vi.advanceTimersByTime(1500);
		expect(panel.webContents.send).not.toHaveBeenCalled();
		expect(replacement?.webContents.send).toHaveBeenCalledTimes(1);
		expect(management.webContents.send).toHaveBeenCalledTimes(1);
	});

	it("tracks work-area changes and clamps the panel to the available area", () => {
		const { panel } = windows();
		const smaller = makeDisplay({
			...panelDisplay,
			workArea: { x: -1600, y: 20, width: 1600, height: 400 },
		});
		electron.screen.getAllDisplays.mockReturnValue([primary, smaller]);
		displayEvent("display-metrics-changed");
		expect(panel.setBounds).toHaveBeenLastCalledWith(smaller.workArea);
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

	it("unregisters display callbacks and stops the bus before quitting", () => {
		appEvent("before-quit");
		for (const [event, listener] of electron.screen.on.mock.calls) {
			expect(electron.screen.removeListener).toHaveBeenCalledWith(
				event,
				listener,
			);
		}
		expect(vi.getTimerCount()).toBe(0);
	});
});
