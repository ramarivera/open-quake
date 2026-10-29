import type { BrowserWindowConstructorOptions } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDisplay } from "../test/display";
import {
	createPanelWindow,
	destroyPanel,
	parkPanel,
	placePanel,
	showPanel,
} from "./panel-window";

const native = vi.hoisted(() => {
	class Window {
		static windows: Window[] = [];
		destroyed = false;
		listeners = new Map<string, (...args: unknown[]) => void>();
		webContents = {
			setZoomFactor: vi.fn(),
			setAudioMuted: vi.fn(),
			reload: vi.fn(),
			on: vi.fn((event: string, f: (...args: unknown[]) => void) =>
				this.listeners.set(event, f),
			),
		};
		setBounds = vi.fn();
		setAlwaysOnTop = vi.fn();
		setOpacity = vi.fn();
		hide = vi.fn();
		showInactive = vi.fn();
		moveTop = vi.fn();
		restore = vi.fn();
		setIgnoreMouseEvents = vi.fn();
		setVisibleOnAllWorkspaces = vi.fn();
		constructor(readonly options: BrowserWindowConstructorOptions) {
			Window.windows.push(this);
		}
		on = vi.fn((event: string, f: (...args: unknown[]) => void) =>
			this.listeners.set(event, f),
		);
		isDestroyed = () => this.destroyed;
		destroy = vi.fn(() => {
			this.destroyed = true;
			this.listeners.get("closed")?.();
		});
	}
	return { BrowserWindow: Window };
});
vi.mock("electron", () => native);
const target = {
	display: makeDisplay({
		id: 2,
		size: { width: 960, height: 240 },
		scaleFactor: 2,
	}),
	isPanel: true,
};
function current() {
	const win = native.BrowserWindow.windows[0];
	if (!win) throw Error("missing panel");
	return win;
}
beforeEach(() => {
	vi.useFakeTimers();
	native.BrowserWindow.windows = [];
});
afterEach(() => {
	for (const win of native.BrowserWindow.windows) win.destroy();
	vi.useRealTimers();
});
describe("native panel owner", () => {
	it.each(["win32", "darwin", "linux"])(
		"applies secure platform policy and readiness ordering on %s",
		(platform) => {
			const panel = createPanelWindow(target, false, platform);
			const win = current();
			expect(win.options).toMatchObject({
				frame: false,
				transparent: true,
				focusable: false,
				skipTaskbar: true,
				fullscreenable: false,
				webPreferences: { contextIsolation: true, nodeIntegration: false },
			});
			expect(win.options.type).toBe(
				platform === "darwin"
					? "panel"
					: platform === "linux"
						? "dock"
						: undefined,
			);
			expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
			showPanel(panel);
			expect(win.showInactive).not.toHaveBeenCalled();
			vi.advanceTimersByTime(5000);
			expect(win.showInactive).not.toHaveBeenCalled();
			win.listeners.get("did-finish-load")?.();
			expect(win.webContents.setZoomFactor).toHaveBeenLastCalledWith(0.5);
			expect(win.setBounds).toHaveBeenLastCalledWith(target.display.bounds);
			expect(win.setOpacity).toHaveBeenLastCalledWith(1);
			expect(win.showInactive).toHaveBeenCalledOnce();
			if (platform === "win32") {
				const tops = win.moveTop.mock.calls.length;
				vi.advanceTimersByTime(1000);
				expect(win.moveTop.mock.calls.length).toBe(tops + 1);
			}
			destroyPanel(panel);
			const tops = win.moveTop.mock.calls.length;
			vi.advanceTimersByTime(10000);
			expect(win.moveTop.mock.calls.length).toBe(tops);
		},
	);
	it("destroys the macOS shield exactly 350ms after reveal and on slow-load park/replacement", () => {
		const panel = createPanelWindow(target, false, "darwin");
		showPanel(panel);
		const shield = native.BrowserWindow.windows[1];
		expect(shield?.options.title).toContain("shield");
		current().listeners.get("ready-to-show")?.();
		vi.advanceTimersByTime(349);
		expect(shield?.destroy).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(shield?.destroy).toHaveBeenCalledOnce();
		const next = createPanelWindow(target, false, "darwin");
		showPanel(next);
		const slowShield = native.BrowserWindow.windows.at(-1);
		parkPanel(next);
		expect(slowShield?.isDestroyed()).toBe(true);
		destroyPanel(next);
		vi.advanceTimersByTime(10000);
		expect(
			native.BrowserWindow.windows.filter((w) => !w.isDestroyed()),
		).toHaveLength(1);
	});
	it("parks, cancels stale minimizes, restores bounds and preserves unrelated windows", () => {
		const panel = createPanelWindow(target, false, "win32");
		const win = current();
		showPanel(panel);
		win.listeners.get("did-finish-load")?.();
		win.listeners.get("minimize")?.();
		vi.advanceTimersByTime(10);
		expect(win.restore).toHaveBeenCalledOnce();
		win.listeners.get("minimize")?.();
		parkPanel(panel);
		vi.advanceTimersByTime(10);
		expect(win.restore).toHaveBeenCalledOnce();
		expect(win.setBounds).toHaveBeenLastCalledWith({
			x: 0,
			y: 0,
			width: 1,
			height: 1,
		});
		placePanel(panel, target);
		showPanel(panel);
		expect(win.setBounds).toHaveBeenLastCalledWith(target.display.bounds);
		const unrelated = new native.BrowserWindow({ title: "management" });
		destroyPanel(panel);
		expect(unrelated.isDestroyed()).toBe(false);
	});
	it("reloads crashed renderers, bounds a crash loop and cancels recovery on destruction", () => {
		const panel = createPanelWindow(target, false, "darwin");
		const win = current();
		showPanel(panel);
		for (let n = 0; n < 4; n++) {
			win.listeners.get("render-process-gone")?.({}, { reason: "crashed" });
			vi.advanceTimersByTime(250);
		}
		expect(win.webContents.reload).toHaveBeenCalledTimes(3);
		vi.advanceTimersByTime(60_000);
		win.listeners.get("render-process-gone")?.({}, { reason: "oom" });
		destroyPanel(panel);
		vi.advanceTimersByTime(250);
		expect(win.webContents.reload).toHaveBeenCalledTimes(3);
	});
	it("keeps desktop preview interactive", () => {
		createPanelWindow({ ...target, isPanel: false }, true, "linux");
		expect(current().setIgnoreMouseEvents).not.toHaveBeenCalled();
		expect(current().options).toMatchObject({
			focusable: true,
			transparent: false,
			show: true,
		});
	});
});
it("recovers a parked crashed panel and reports the native exit details", () => {
	const report = vi.fn();
	const panel = createPanelWindow(target, false, "darwin", report),
		win = current();
	showPanel(panel);
	win.listeners.get("render-process-gone")?.(
		{},
		{ reason: "crashed", exitCode: 9 },
	);
	parkPanel(panel);
	vi.advanceTimersByTime(250);
	expect(win.webContents.reload).toHaveBeenCalledOnce();
	expect(report).toHaveBeenCalledWith("retry", {
		reason: "crashed",
		exitCode: 9,
	});
	win.listeners.get("did-finish-load")?.();
	showPanel(panel);
	expect(win.showInactive).toHaveBeenCalled();
});
