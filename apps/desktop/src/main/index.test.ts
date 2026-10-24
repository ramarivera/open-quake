import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	BrowserWindowConstructorOptions,
	Display,
	Rectangle,
} from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerKnob } from "./knob";
import { registerMaintenance } from "./maintenance";
import { registerMedia } from "./media";
import { registerMonitor } from "./monitor";
import { registerProfiles } from "./profiles";
import { makeDisplay } from "./test/display";
import { report } from "./test/hid";
import { registerVoiceSurface } from "./voice";

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
		hide = vi.fn();
		showInactive = vi.fn();
		show = vi.fn();
		focus = vi.fn();
		restore = vi.fn();
		isMinimized = vi.fn(() => false);
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
			isPackaged: false,
			requestSingleInstanceLock: vi.fn(() => true),
			removeListener: vi.fn(),
			whenReady: vi.fn(() => Promise.resolve()),
			getPath: vi.fn(() => join(tmpdir(), "open-quake-window-test")),
			getVersion: () => "0.0.0",
			on: vi.fn<
				(
					event: string,
					listener: (event: { preventDefault(): void }) => void,
				) => void
			>(),
			quit: vi.fn(),
		},
		ipcMain: {
			on: vi.fn(),
			removeListener: vi.fn(),
			handle: vi.fn(),
			removeHandler: vi.fn(),
		},
		nativeTheme: { themeSource: "system" },
		safeStorage: { isEncryptionAvailable: () => false },
		powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
		dialog: { showMessageBox: vi.fn(() => Promise.resolve({ response: 1 })) },
		shell: { openExternal: vi.fn() },
		screen: {
			getAllDisplays: vi.fn<() => Display[]>(),
			getPrimaryDisplay: vi.fn<() => Display>(),
			on: vi.fn<(event: string, listener: () => void) => void>(),
			removeListener: vi.fn<(event: string, listener: () => void) => void>(),
		},
	};
});

vi.mock("electron", () => electron);
vi.mock("./agents", () => ({
	registerAgents: vi.fn(() => ({ dispose: vi.fn(async () => {}) })),
}));
vi.mock("./integrations", () => ({
	registerIntegrations: vi.fn(() => ({ dispose: vi.fn(async () => {}) })),
}));
vi.mock("./emoji", () => ({
	registerEmoji: vi.fn(() => ({ dispose: vi.fn(async () => {}) })),
}));
vi.mock("./maintenance", () => ({
	registerMaintenance: vi.fn(() => ({
		dispose: vi.fn(async () => {}),
		ready: Promise.resolve(),
	})),
}));
vi.mock("./monitor", () => ({
	registerMonitor: vi.fn(() => ({ dispose: vi.fn(async () => {}) })),
}));
vi.mock("./profiles", () => ({
	registerProfiles: vi.fn(() => ({
		runtime: { runFork: vi.fn(), runPromise: vi.fn() },
		select: vi.fn(),
		connect: vi.fn(async () => {}),
		disconnect: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
	})),
}));

vi.mock("./lifecycle/native-display", async (original) => {
	const actual = await original<typeof import("./lifecycle/native-display")>();
	const { Effect } = await import("effect");
	return {
		...actual,
		callDisplayTool: vi.fn(() => Effect.succeed("extended")),
		probeHiddenMirroring: vi.fn(() => Effect.succeed(false)),
	};
});
vi.mock("./knob", () => ({
	registerKnob: vi.fn(() => ({
		onDevice: () => {},
		refresh: () => Promise.resolve(),
		dispose: vi.fn(async () => {}),
	})),
}));
vi.mock("./media", async () => {
	const { Layer } = await import("effect");
	return {
		MediaLive: vi.fn(() => Layer.empty),
		registerMedia: vi.fn(() => ({ dispose: vi.fn(async () => {}) })),
	};
});
vi.mock("./clock", async () => {
	const { Layer } = await import("effect");
	return {
		ClockLive: vi.fn(() => Layer.empty),
		registerClock: vi.fn(() => ({ dispose: vi.fn(async () => {}) })),
		registerClockScheme: vi.fn(),
	};
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
vi.mock("./voice", async () => {
	const { Effect } = await import("effect");
	return {
		createToneRecorder: vi.fn(() => ({ play: vi.fn(), played: () => [] })),
		toneSinks: vi.fn(() => ({ play: vi.fn() })),
		registerVoiceSurface: vi.fn(() => ({
			onDevice: vi.fn(async () => undefined),
			publish: vi.fn(async () => undefined),
			knobVoice: vi.fn(() => Effect.void),
			dispose: vi.fn(async () => undefined),
		})),
	};
});

function displayEvent(name: string): void {
	const listeners = electron.screen.on.mock.calls.filter(
		([event]) => event === name,
	);
	expect(listeners.length).toBeGreaterThan(0);
	for (const [, listener] of listeners) listener();
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
			expect(windows().management.webContents.send).toHaveBeenCalledWith(
				"quake:event",
				{ source: "mock", kind: "status", state: "connected" },
			),
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
		expect(vi.mocked(registerProfiles).mock.calls[0]?.[0]()).toBe(management);
		expect(registerMonitor).toHaveBeenCalledOnce();
		expect(vi.mocked(registerMonitor).mock.calls[0]?.[1]()).toBe(management);
		expect(vi.mocked(registerMonitor).mock.calls[0]?.[2]()).toBe(panel);
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

	it("focuses and restores the existing management window on second launch", () => {
		const { management } = windows();
		management.isMinimized.mockReturnValue(true);
		appEvent("second-instance");
		expect(management.restore).toHaveBeenCalledOnce();
		expect(management.show).toHaveBeenCalledOnce();
		expect(management.focus).toHaveBeenCalledOnce();
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

	it("swaps to a strip panel when DK-QUAKE is attached, then back to a normal fallback", async () => {
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
		await vi.waitFor(() =>
			expect(
				electron.BrowserWindow.windows.at(-1)?.setBounds,
			).toHaveBeenLastCalledWith(panelDisplay.bounds),
		);
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
		await vi.waitFor(() =>
			expect(
				electron.BrowserWindow.windows.at(-1)?.options.type,
			).toBeUndefined(),
		);
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

	it("recreates a destroyed panel on hot-plug and forwards to the replacement", async () => {
		const { panel, management } = windows();
		panel.webContents.send.mockClear();
		management.webContents.send.mockClear();
		panel.destroyed = true;
		electron.screen.getAllDisplays.mockReturnValue([primary, panelDisplay]);
		displayEvent("display-added");
		await vi.waitFor(() =>
			expect(
				electron.BrowserWindow.windows.at(-1)?.setBounds,
			).toHaveBeenLastCalledWith(panelDisplay.bounds),
		);
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
		expect(
			management.webContents.send.mock.calls.filter(
				([channel]) => channel === "quake:event",
			),
		).toHaveLength(1);
	});

	it("follows display moves and reloads only when the strip's rotation changes", async () => {
		electron.screen.getAllDisplays.mockReturnValue([primary, panelDisplay]);
		displayEvent("display-added");
		await vi.waitFor(() =>
			expect(
				electron.BrowserWindow.windows.at(-1)?.setBounds,
			).toHaveBeenLastCalledWith(panelDisplay.bounds),
		);
		const panel = electron.BrowserWindow.windows.at(-1);
		if (!panel) throw new Error("The strip panel must exist");
		const loads = panel.loadURL.mock.calls.length;
		const moved = makeDisplay({
			...panelDisplay,
			bounds: { x: 2560, y: 0, width: 480, height: 1920 },
		});
		electron.screen.getAllDisplays.mockReturnValue([primary, moved]);
		displayEvent("display-metrics-changed");
		await vi.waitFor(() =>
			expect(panel.setBounds).toHaveBeenLastCalledWith(
				electron.screen.getAllDisplays()[1]?.bounds,
			),
		);
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
		await vi.waitFor(() =>
			expect(panel.setBounds).toHaveBeenLastCalledWith(
				electron.screen.getAllDisplays()[1]?.bounds,
			),
		);
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
			expect(
				window.webContents.send.mock.calls.filter(
					([channel]) => channel === "quake:event",
				),
			).toHaveLength(1);
		}
		expect(panel.webContents.send).not.toHaveBeenCalled();
		expect(management.webContents.send).not.toHaveBeenCalled();
	});
	it("disconnects the old mock profile session before reopening initializes it again", async () => {
		const profiles = vi.mocked(registerProfiles).mock.results[0]?.value;
		if (!profiles) throw new Error("Missing profile registration");
		await vi.waitFor(() =>
			expect(profiles.connect).toHaveBeenCalledWith("desktop-preview"),
		);
		for (const win of Object.values(windows())) win.destroy();
		appEvent("window-all-closed");
		appEvent("activate");
		await vi.waitFor(() =>
			expect(profiles.disconnect).toHaveBeenCalledExactlyOnceWith(
				"desktop-preview",
			),
		);
		await vi.waitFor(() => expect(profiles.connect).toHaveBeenCalledTimes(2));
		expect(
			vi.mocked(profiles.disconnect).mock.invocationCallOrder[0],
		).toBeLessThan(
			vi.mocked(profiles.connect).mock.invocationCallOrder[1] ?? 0,
		);
	});

	for (const state of ["malformed", "unreadable", "runtime-failure"] as const) {
		it(`completes awaited combined quit after ${state} maintenance initialization`, async () => {
			const root = await mkdtemp(join(tmpdir(), "combined-quit-"));
			const actual =
				await vi.importActual<typeof import("./maintenance")>("./maintenance");
			const sessions = await import("./maintenance/firmware-session");
			if (state === "malformed")
				await writeFile(
					join(root, "firmware-session-v1.json"),
					"{synthetic-invalid",
				);
			else if (state === "unreadable")
				await mkdir(join(root, "firmware-session-v1.json"));
			else
				vi.spyOn(sessions, "firmwareSessionStore").mockReturnValueOnce({
					load: async () => {
						throw new Error("synthetic runtime failure");
					},
					save: async () => {},
				});
			const real = actual.registerMaintenance({
				root,
				mock: true,
				renderer: "https://fixture.invalid",
				hardware: () => undefined,
				management: () => undefined,
				stopWriters: async () => {},
			});
			const owned = vi.mocked(registerMaintenance).mock.results.at(-1)?.value;
			const monitor = vi.mocked(registerMonitor).mock.results.at(-1)?.value;
			const voice = vi.mocked(registerVoiceSurface).mock.results.at(-1)?.value;
			const profiles = vi.mocked(registerProfiles).mock.results.at(-1)?.value;
			if (!owned || !monitor || !voice || !profiles)
				throw new Error("Missing combined owners");
			const dispose = vi
				.mocked(owned.dispose)
				.mockImplementation(() => real.dispose());
			let release = () => {};
			vi.mocked(voice.dispose).mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						release = resolve;
					}),
			);
			try {
				if (state === "runtime-failure")
					await expect(real.ready).rejects.toBeDefined();
				else await expect(real.ready).resolves.toBeUndefined();
				expect(appEvent("before-quit").preventDefault).toHaveBeenCalledOnce();
				await vi.waitFor(() => expect(voice.dispose).toHaveBeenCalledOnce());
				expect(monitor.dispose).toHaveBeenCalledOnce();
				expect(profiles.dispose).not.toHaveBeenCalled();
				expect(electron.app.quit).not.toHaveBeenCalled();
				expect(appEvent("before-quit").preventDefault).toHaveBeenCalledOnce();
				expect(dispose).toHaveBeenCalledOnce();
				release();
				await vi.waitFor(() =>
					expect(electron.app.quit).toHaveBeenCalledOnce(),
				);
				expect(profiles.dispose).toHaveBeenCalledOnce();
				expect(appEvent("before-quit").preventDefault).not.toHaveBeenCalled();
			} finally {
				release();
				await real.dispose().catch(() => undefined);
				await rm(root, { recursive: true, force: true });
			}
		});
	}

	it("awaits voice disposal after knob and monitor before releasing quit", async () => {
		const voice = vi.mocked(registerVoiceSurface).mock.results[0]?.value;
		const knob = vi.mocked(registerKnob).mock.results[0]?.value;
		const monitor = vi.mocked(registerMonitor).mock.results[0]?.value;
		const profiles = vi.mocked(registerProfiles).mock.results[0]?.value;
		if (!voice || !knob || !monitor || !profiles)
			throw new Error("Missing combined owner");
		let releaseVoice = () => {};
		vi.mocked(voice.dispose).mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					releaseVoice = resolve;
				}),
		);
		appEvent("before-quit");
		await vi.waitFor(() => expect(voice.dispose).toHaveBeenCalledOnce());
		try {
			expect(monitor.dispose).toHaveBeenCalledOnce();
			expect(knob.dispose).toHaveBeenCalledOnce();
			expect(vi.mocked(knob.dispose).mock.invocationCallOrder[0]).toBeLessThan(
				vi.mocked(voice.dispose).mock.invocationCallOrder[0] ?? 0,
			);
			expect(profiles.dispose).not.toHaveBeenCalled();
			expect(electron.app.quit).not.toHaveBeenCalled();
			appEvent("before-quit");
			expect(voice.dispose).toHaveBeenCalledOnce();
		} finally {
			releaseVoice();
		}
		await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalledOnce());
		expect(profiles.dispose).toHaveBeenCalledOnce();
	});

	it("unregisters display callbacks and stops the bus before quitting", async () => {
		appEvent("before-quit");
		await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
		const monitor = vi.mocked(registerMonitor).mock.results[0]?.value;
		if (!monitor) throw new Error("Missing monitor registration");
		expect(monitor.dispose).toHaveBeenCalledOnce();
		expect(vi.mocked(monitor.dispose).mock.invocationCallOrder[0]).toBeLessThan(
			electron.app.quit.mock.invocationCallOrder[0] ?? 0,
		);
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
				([channel, event]) =>
					channel !== "quake:event" || event.source === "hid",
			),
		).toBe(true);
		expect(JSON.stringify(panel.webContents.send.mock.calls)).not.toContain(
			"private-native-cause",
		);
		appEvent("before-quit");
		await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
		expect(await Effect.runPromise(fake.closes)).toBe(2);
	});

	it("pairs by blanking through the existing handle and keeps the same panel during brief USB loss", async () => {
		const primary = makeDisplay();
		const strip = makeDisplay({
			id: 2,
			label: "DK-QUAKE",
			size: { width: 1920, height: 480 },
			bounds: { x: 2560, y: 0, width: 1920, height: 480 },
		});
		const returned = { ...strip, id: 4 };
		const { HidTransport: Transport } = await import("@open-quake/device");
		const { Layer: Layers } = await import("effect");
		native.layer = Layers.succeed(Transport, {
			...fake.transport,
			open: (info) =>
				Effect.map(fake.transport.open(info), (handle) => ({
					...handle,
					write: (bytes) =>
						handle.write(bytes).pipe(
							Effect.tap(() =>
								Effect.sync(() => {
									if (bytes[4] !== 4) return;
									electron.screen.getAllDisplays.mockReturnValue(
										bytes[5] === 0 ? [primary] : [primary, returned],
									);
									displayEvent(
										bytes[5] === 0 ? "display-removed" : "display-added",
									);
								}),
							),
						),
				})),
		});
		electron.screen.getAllDisplays.mockReturnValue([primary, strip]);
		await start();
		const panel = windows().panel;
		await vi.waitFor(() =>
			expect(panel.setBounds).toHaveBeenLastCalledWith(returned.bounds),
		);
		expect(
			(await Effect.runPromise(fake.writes))
				.filter((bytes) => bytes[4] === 4)
				.map((bytes) => bytes[5]),
		).toEqual([0, 1]);
		expect(await Effect.runPromise(fake.opens)).toBe(1);
		await Effect.runPromise(fake.failRead(new Error("unplug")));
		await vi.waitFor(() => expect(panel.hide).toHaveBeenCalled());
		await vi.waitFor(
			async () => expect(await Effect.runPromise(fake.opens)).toBe(2),
			{ timeout: 2500 },
		);
		expect(windows().panel).toBe(panel);
		expect(panel.destroy).not.toHaveBeenCalled();
	});

	it.each(["activate", "second-instance"])(
		"restarts the bus and unlocks lifecycle recovery on %s after all windows close",
		async (event) => {
			await start();
			const { panel, management } = windows();
			panel.destroyed = true;
			await Effect.runPromise(fake.emit(report(3, 2, [1])));
			await vi.waitFor(() =>
				expect(management.webContents.send).toHaveBeenCalledWith(
					"quake:event",
					{
						source: "hid",
						kind: "press",
						state: 1,
					},
				),
			);
			expect(await Effect.runPromise(fake.closes)).toBe(0);
			management.destroyed = true;
			appEvent("window-all-closed");
			await vi.waitFor(async () =>
				expect(await Effect.runPromise(fake.closes)).toBe(1),
			);
			appEvent(event);
			await vi.waitFor(async () =>
				expect(await Effect.runPromise(fake.opens)).toBe(2),
			);
			const reopened = electron.BrowserWindow.getAllWindows().find(
				(window) => window.options.title === "open-quake — management",
			);
			if (!reopened) throw new Error("Management must reopen");
			expect(reopened).not.toBe(management);
			if (event === "second-instance") {
				expect(reopened.show).toHaveBeenCalledOnce();
				expect(reopened.focus).toHaveBeenCalledOnce();
			}
			await Effect.runPromise(fake.emit(report(3, 1, [0])));
			for (const window of electron.BrowserWindow.getAllWindows())
				await vi.waitFor(() =>
					expect(window.webContents.send).toHaveBeenCalledWith("quake:event", {
						source: "hid",
						kind: "rotate",
						direction: -1,
					}),
				);
			await vi.waitFor(
				() =>
					expect(reopened.webContents.send).toHaveBeenCalledWith(
						"quake:diagnostic",
						expect.objectContaining({ checking: true }),
					),
				{ timeout: 4000 },
			);
		},
	);

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

	it.each(["activate", "second-instance"])(
		"holds quit and rapid %s reopening until native close finishes",
		async (reopenEvent) => {
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
			appEvent(reopenEvent);
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
		},
	);
});

describe("single-instance startup and release policy", () => {
	it("refuses startup before readiness, windows, discovery or HID open", async () => {
		vi.resetModules();
		const fake = await Effect.runPromise(makeFakeHidTransport());
		native.layer = fake.layer;
		electron.BrowserWindow.windows = [];
		electron.app.requestSingleInstanceLock.mockReturnValue(false);
		const output = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		await import("./index");
		expect(electron.app.whenReady).not.toHaveBeenCalled();
		expect(electron.BrowserWindow.windows).toHaveLength(0);
		expect(await Effect.runPromise(fake.opens)).toBe(0);
		expect(electron.app.quit).toHaveBeenCalledOnce();
		expect(output).toHaveBeenCalledWith(
			expect.stringContaining("Refusing a second device connection"),
		);
		electron.app.requestSingleInstanceLock.mockReturnValue(true);
	});
	it.each(["destroyed", "hidden", "minimized"])(
		"activate reopens %s management while the packaged hidden fallback survives",
		async (state) => {
			vi.resetModules();
			vi.stubEnv("ELECTRON_RENDERER_URL", "");
			electron.app.isPackaged = true;
			native.layer = (await Effect.runPromise(makeFakeHidTransport([]))).layer;
			electron.BrowserWindow.windows = [];
			const display = makeDisplay();
			electron.screen.getAllDisplays.mockReturnValue([display]);
			electron.screen.getPrimaryDisplay.mockReturnValue(display);
			await import("./index");
			await vi.waitFor(() =>
				expect(electron.BrowserWindow.windows).toHaveLength(2),
			);
			expect(windows().panel.options.show).toBe(false);
			expect(windows().panel.showInactive).not.toHaveBeenCalled();
			const { panel, management } = windows();
			management.destroyed = state === "destroyed";
			management.isMinimized.mockReturnValue(state === "minimized");
			appEvent("activate");
			const reopened = electron.BrowserWindow.getAllWindows().find(
				(window) => window !== panel,
			);
			expect(reopened).toBeDefined();
			expect(panel.destroyed).toBe(false);
			expect(reopened?.show).toHaveBeenCalledOnce();
			expect(reopened?.focus).toHaveBeenCalledOnce();
			if (state === "destroyed") expect(reopened).not.toBe(management);
			else expect(reopened).toBe(management);
			if (state === "minimized")
				expect(management.restore).toHaveBeenCalledOnce();
			appEvent("before-quit");
			await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
			electron.app.isPackaged = false;
			vi.unstubAllEnvs();
		},
	);
});
