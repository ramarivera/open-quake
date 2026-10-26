import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	BrowserWindowConstructorOptions,
	Display,
	Rectangle,
} from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createEmptyProfileKey,
	ProfileKey,
} from "../../../../packages/device/src/profiles/profile-contracts";
import { LOCALE_REQUEST } from "../shared/locale";
import { registerAgentHttp } from "./agent-http";
import { makeDesktopRuntime } from "./diagnostics/runtime";
import { registerIntegrations } from "./integrations";
import { registerKnob } from "./knob";
import { registerMaintenance } from "./maintenance";
import { registerMedia } from "./media";
import { registerMeetings } from "./meetings";
import { startMockDeviceBus } from "./mockDeviceBus";
import { registerMonitor } from "./monitor";
import { registerProfiles } from "./profiles";
import { makeDisplay } from "./test/display";
import { makeTwoStrips, report } from "./test/hid";
import { registerVoiceSurface } from "./voice";
import { registerWeatherMedia } from "./weather-media";

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
		contentListeners = new Map<string, () => void>();
		webContents = {
			send: vi.fn(),
			setAudioMuted: vi.fn(),
			setZoomFactor: vi.fn(),
			removeListener: vi.fn(),
			on: vi.fn((event: string, listener: () => void) =>
				this.contentListeners.set(event, listener),
			),
			isDestroyed: () => this.destroyed,
		};
		loadURL = vi.fn(() => {
			this.contentListeners.get("did-finish-load")?.();
		});
		loadFile = vi.fn(() => {
			this.contentListeners.get("did-finish-load")?.();
		});
		setBounds = vi.fn<(bounds: Rectangle) => void>();
		hide = vi.fn();
		setOpacity = vi.fn();
		setIgnoreMouseEvents = vi.fn();
		setVisibleOnAllWorkspaces = vi.fn();
		moveTop = vi.fn();
		showInactive = vi.fn();
		show = vi.fn();
		focus = vi.fn();
		restore = vi.fn();
		isMinimized = vi.fn(() => false);
		isMaximized = vi.fn(() => false);
		isFullScreen = vi.fn(() => false);
		getBounds = vi.fn(() => ({ x: 0, y: 0, width: 1100, height: 760 }));
		removeListener = vi.fn();
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
			if (options.title !== "open-quake panel shield")
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
			getLocale: vi.fn(() => "en-US"),
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
		powerSaveBlocker: { start: vi.fn(() => 7), stop: vi.fn() },
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
vi.mock("./mockDeviceBus", async (original) => {
	const actual = await original<typeof import("./mockDeviceBus")>();
	return { ...actual, startMockDeviceBus: vi.fn(actual.startMockDeviceBus) };
});
vi.mock("./diagnostics/runtime", async (original) => {
	const actual = await original<typeof import("./diagnostics/runtime")>();
	return { ...actual, makeDesktopRuntime: vi.fn(actual.makeDesktopRuntime) };
});
vi.mock("./agents", async () => {
	const { Layer } = await import("effect");
	const { prepareDesktopModule } = await import("./diagnostics/module");
	const registration = {
		registerAgents: vi.fn((..._args: unknown[]) => ({
			dispose: vi.fn(async () => {}),
		})),
	};
	return {
		...registration,
		prepareAgents: (...args: unknown[]) => {
			const module = prepareDesktopModule(Layer.empty, () =>
				registration.registerAgents(...args),
			);
			return module;
		},
	};
});
vi.mock("./integrations", async () => {
	const { Layer } = await import("effect");
	const { prepareDesktopModule } = await import("./diagnostics/module");
	const registration = {
		registerIntegrations: vi.fn((..._args: unknown[]) => ({
			dispose: vi.fn(async () => {}),
			executeHaFromKey: vi.fn(async () => {}),
		})),
	};
	return {
		...registration,
		prepareIntegrations: (...args: unknown[]) => {
			const module = prepareDesktopModule(Layer.empty, () =>
				registration.registerIntegrations(...args),
			);
			return module;
		},
	};
});
vi.mock("./emoji", async () => {
	const { Layer } = await import("effect");
	const { prepareDesktopModule } = await import("./diagnostics/module");
	const registration = {
		registerEmoji: vi.fn((..._args: unknown[]) => ({
			dispose: vi.fn(async () => {}),
		})),
	};
	return {
		...registration,
		prepareEmoji: (...args: unknown[]) => {
			const module = prepareDesktopModule(Layer.empty, () =>
				registration.registerEmoji(...args),
			);
			return module;
		},
	};
});
vi.mock("./maintenance", async () => {
	const { Layer } = await import("effect");
	const { prepareDesktopModule } = await import("./diagnostics/module");
	const registration = {
		registerMaintenance: vi.fn((..._args: unknown[]) => ({
			dispose: vi.fn(async () => {}),
			ready: Promise.resolve(),
		})),
	};
	return {
		...registration,
		prepareMaintenance: (...args: unknown[]) => {
			const module = prepareDesktopModule(Layer.empty, () =>
				registration.registerMaintenance(...args),
			);
			return module;
		},
	};
});
vi.mock("./monitor", async () => {
	const { Layer } = await import("effect");
	const { prepareDesktopModule } = await import("./diagnostics/module");
	const registration = {
		registerMonitor: vi.fn((..._args: unknown[]) => ({
			dispose: vi.fn(async () => {}),
		})),
	};
	return {
		...registration,
		prepareMonitor: (...args: unknown[]) => {
			const module = prepareDesktopModule(Layer.empty, () =>
				registration.registerMonitor(...args),
			);
			return module;
		},
	};
});
vi.mock("./profiles", async () => {
	const { Layer } = await import("effect");
	const { prepareDesktopModule } = await import("./diagnostics/module");
	const registration = {
		registerProfiles: vi.fn((..._args: unknown[]) => ({
			runtime: { runFork: vi.fn(), runPromise: vi.fn() },
			select: vi.fn(),
			connect: vi.fn(async () => {}),
			disconnect: vi.fn(async () => {}),
			resetKeys: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
		})),
	};
	return {
		...registration,
		prepareProfiles: (...args: unknown[]) => {
			const module = prepareDesktopModule(Layer.empty, () =>
				registration.registerProfiles(...args),
			);
			return module;
		},
	};
});

vi.mock("./lifecycle/native-display", async (original) => {
	const actual = await original<typeof import("./lifecycle/native-display")>();
	const { Effect } = await import("effect");
	return {
		...actual,
		callDisplayTool: vi.fn(() => Effect.succeed("extended")),
		probeHiddenMirroring: vi.fn(() => Effect.succeed(false)),
	};
});
vi.mock("./meetings", async () => {
	const { Layer } = await import("effect");
	const { prepareDesktopModule } = await import("./diagnostics/module");
	const registration = {
		registerMeetings: vi.fn((..._args: unknown[]) => ({
			dispose: vi.fn(async () => {}),
		})),
	};
	return {
		...registration,
		prepareMeetings: (...args: unknown[]) => {
			const module = prepareDesktopModule(Layer.empty, () =>
				registration.registerMeetings(...args),
			);
			return module;
		},
	};
});
vi.mock("./knob", async () => {
	const { Layer } = await import("effect");
	const { prepareDesktopModule } = await import("./diagnostics/module");
	const registration = {
		registerKnob: vi.fn((..._args: unknown[]) => ({
			onDevice: vi.fn(async (_event: unknown) => {}),
			refresh: () => Promise.resolve(),
			dispose: vi.fn(async () => {}),
		})),
	};
	return {
		...registration,
		prepareKnob: (...args: unknown[]) => {
			const module = prepareDesktopModule(Layer.empty, () =>
				registration.registerKnob(...args),
			);
			return module;
		},
	};
});
vi.mock("./media", async () => {
	const { Layer } = await import("effect");
	return {
		MediaLive: vi.fn(() => Layer.empty),
		registerMedia: vi.fn(() => ({ dispose: vi.fn(async () => {}) })),
	};
});
vi.mock("./weather-media", async () => {
	const { Layer } = await import("effect");
	return {
		weatherMediaLive: vi.fn(() => Layer.empty),
		registerWeatherMedia: vi.fn(() => ({
			dispose: vi.fn(async () => undefined),
		})),
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
	const { Layer } = await import("effect");
	const { prepareDesktopModule } = await import("./diagnostics/module");

	const { Effect } = await import("effect");
	const registration = {
		createToneRecorder: vi.fn(() => ({ play: vi.fn(), played: () => [] })),
		toneSinks: vi.fn(() => ({ play: vi.fn() })),
		registerVoiceSurface: vi.fn((..._args: unknown[]) => ({
			ready: Promise.resolve(),
			reset: vi.fn(async () => undefined),
			onDevice: vi.fn(async () => undefined),
			publish: vi.fn(async () => undefined),
			knobVoice: vi.fn(() => Effect.void),
			dispose: vi.fn(async () => undefined),
		})),
	};
	return {
		...registration,
		prepareVoiceSurface: (...args: unknown[]) => {
			const module = prepareDesktopModule(Layer.empty, () =>
				registration.registerVoiceSurface(...args),
			);
			return module;
		},
	};
});

vi.mock("./agent-http", async () => {
	const { Effect, Layer } = await import("effect");
	const { prepareDesktopModule } = await import("./diagnostics/module");
	const registration = {
		registerAgentHttp: vi.fn(async (..._args: unknown[]) => ({
			backend: undefined,
			configured: vi.fn(async () => false),
			drafting: undefined,
			createVoiceAdapter: vi.fn(),
			decorateVoiceRuntime: vi.fn(),
			dispose: vi.fn(async () => undefined),
		})),
	};
	return {
		...registration,
		prepareAgentHttp: (...args: unknown[]) => {
			const module = prepareDesktopModule(Layer.empty, () =>
				registration.registerAgentHttp(...args),
			);
			return {
				...module,
				backend: undefined,
				drafting: undefined,
				createVoiceAdapter: () => Effect.void,
			};
		},
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
		// A prior window-all-closed quit call doesn't prove async shutdown ended.
		// An unprevented before-quit means shutdown already finished in the test.
		const priorQuits = electron.app.quit.mock.calls.length;
		const event = appEvent("before-quit");
		if (event.preventDefault.mock.calls.length > 0)
			await vi.waitFor(() =>
				expect(electron.app.quit.mock.calls.length).toBeGreaterThan(priorQuits),
			);
		vi.useRealTimers();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("wires saved HA activation to the direct integration consumer", async () => {
		const execute = vi.mocked(registerProfiles).mock.calls[0]?.[6];
		const integrations = vi.mocked(registerIntegrations).mock.results[0]?.value;
		expect(execute).toBeTypeOf("function");
		const base = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
		const config = {
			entity_id: "input_boolean.test",
			service: "toggle",
			service_data: {},
			custom_display_type: "icon",
			custom_display_settings: { fontSize: 20 },
			custom_display_detail: [],
		};
		const key = Schema.decodeUnknownSync(ProfileKey)({
			...base,
			childrenName: "homeAssistant",
			config: {
				...base.config,
				type: "homeAssistant",
				actions: [{ type: "configData", value: JSON.stringify(config) }],
			},
		});
		const signal = new AbortController().signal;
		expect(
			await execute?.(key, signal, {
				deviceId: "device",
				profileId: "p",
				pageId: "one",
				revision: 1,
			}),
		).toBe(true);
		expect(integrations?.executeHaFromKey).toHaveBeenCalledWith(config, signal);
	});

	it("starts both surfaces on the primary display without panel hardware", async () => {
		const { panel, management } = windows();
		expect(makeDesktopRuntime).toHaveBeenCalledOnce();
		for (const win of [panel, management]) {
			const load = win.loadURL.mock.invocationCallOrder[0];
			expect(load).toBeGreaterThan(
				vi.mocked(registerMaintenance).mock.invocationCallOrder[0] ?? Infinity,
			);
			expect(load).toBeGreaterThan(
				electron.ipcMain.handle.mock.invocationCallOrder.at(-1) ?? Infinity,
			);
		}
		expect(
			electron.app.on.mock.calls.filter(([name]) => name === "before-quit"),
		).toHaveLength(1);
		expect(electron.app.getLocale).toHaveBeenCalledOnce();
		expect(electron.ipcMain.handle).toHaveBeenCalledWith(
			LOCALE_REQUEST,
			expect.any(Function),
		);
		expect(registerAgentHttp).toHaveBeenCalledOnce();
		expect(vi.mocked(registerAgentHttp).mock.calls[0]?.[0].management()).toBe(
			management,
		);
		expect(registerMedia).toHaveBeenCalledOnce();
		expect(vi.mocked(registerMedia).mock.calls[0]?.[1]()).toBe(management);
		expect(registerProfiles).toHaveBeenCalledOnce();
		expect(vi.mocked(registerProfiles).mock.calls[0]?.[0]()).toBe(management);
		expect(registerWeatherMedia).toHaveBeenCalledOnce();
		expect(vi.mocked(registerWeatherMedia).mock.calls[0]?.[1]()).toBe(
			management,
		);
		expect(registerMonitor).toHaveBeenCalledOnce();
		expect(vi.mocked(registerMonitor).mock.calls[0]?.[1]()).toBe(management);
		expect(vi.mocked(registerMonitor).mock.calls[0]?.[2]()).toBe(panel);
		expect(registerVoiceSurface).toHaveBeenCalledOnce();
		expect(
			typeof vi.mocked(registerVoiceSurface).mock.calls[0]?.[0].runtime,
		).toBe("function");
		await vi.mocked(registerAgentHttp).mock.calls[0]?.[0].invalidated();
		expect(
			vi.mocked(registerVoiceSurface).mock.results[0]?.value.reset,
		).toHaveBeenCalledOnce();
		expect(vi.mocked(registerVoiceSurface).mock.calls[0]?.[0].panel()).toBe(
			panel,
		);
		expect(panel.options).toMatchObject({
			x: 0,
			y: 0,
			width: 1920,
			height: 480,
			title: "open-quake panel",
			frame: false,
			roundedCorners: false,
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

	it("focuses and restores the existing management window on second launch", async () => {
		const { management } = windows();
		expect(management.options.show).toBe(false);
		// Connected status can arrive before asynchronous settings/window restoration.
		await vi.waitFor(() => expect(management.show).toHaveBeenCalledOnce());
		management.show.mockClear();
		management.isMinimized.mockReturnValue(true);
		appEvent("second-instance");
		await vi.waitFor(() => expect(management.restore).toHaveBeenCalledOnce());
		expect(management.show).toHaveBeenCalledOnce();
		expect(management.focus).toHaveBeenCalledOnce();
	});

	it("cancels pending knob input before draining the bus on quit", async () => {
		const knob = vi.mocked(registerKnob).mock.results.at(-1)?.value;
		const bus = vi.mocked(startMockDeviceBus).mock.results.at(-1)?.value;
		if (!knob || !bus) throw new Error("Missing mock input owners");
		let release = () => {};
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.mocked(knob.onDevice).mockImplementationOnce(() => pending);
		vi.mocked(knob.dispose).mockImplementationOnce(async () => release());
		try {
			bus.emitStatus({ source: "mock", kind: "status", state: "connected" });
			await vi.waitFor(() => expect(knob.onDevice).toHaveReturnedWith(pending));
			appEvent("before-quit");
			await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
			expect(knob.dispose).toHaveBeenCalledOnce();
		} finally {
			release();
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

	it.each(["darwin", "linux", "win32"])(
		"swaps to a strip panel and back to a normal fallback on %s",
		async (platform) => {
			vi.stubGlobal("process", { ...process, platform });
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
				platform === "darwin"
					? "panel"
					: platform === "linux"
						? "dock"
						: undefined,
			);
			// The whole display, menu-bar area included, with the canvas turned upright.
			expect(strip?.setBounds).toHaveBeenLastCalledWith(panelDisplay.bounds);
			expect(strip?.setAlwaysOnTop).toHaveBeenLastCalledWith(
				true,
				"screen-saver",
				process.platform === "darwin" ? 1 : 0,
			);
			expect(strip?.loadURL).toHaveBeenLastCalledWith(
				"http://localhost:5173?surface=panel&rotation=90",
			);
			electron.screen.getAllDisplays.mockReturnValue([primary]);
			displayEvent("display-removed");
			await vi.waitFor(() => expect(strip?.destroy).toHaveBeenCalledOnce());
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
		},
	);

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

	it("MAIN-012 SETTINGS-079 owns final close, voice teardown and the first/last suspension blocker", async () => {
		electron.screen.getAllDisplays.mockReturnValue([primary, panelDisplay]);
		displayEvent("display-added");
		await vi.waitFor(() =>
			expect(
				electron.BrowserWindow.windows.at(-1)?.showInactive,
			).toHaveBeenCalled(),
		);
		const panel = electron.BrowserWindow.windows.at(-1);
		const bus = vi.mocked(startMockDeviceBus).mock.results.at(-1)?.value;
		const voice = vi.mocked(registerVoiceSurface).mock.results.at(-1)?.value;
		if (!panel || !bus || !voice)
			throw new Error("Missing active strip owners");
		expect(electron.powerSaveBlocker.start).toHaveBeenCalledExactlyOnceWith(
			"prevent-app-suspension",
		);
		const lose = () =>
			bus.emitStatus({
				source: "mock",
				kind: "status",
				state: "disconnected",
				reason: "error",
			});
		const reconnect = () =>
			bus.emitStatus({ source: "mock", kind: "status", state: "connected" });
		lose();
		await vi.advanceTimersByTimeAsync(0);
		expect(panel.hide).toHaveBeenCalled();
		expect(voice.onDevice).toHaveBeenCalledWith(
			expect.objectContaining({ state: "disconnected" }),
		);
		await vi.advanceTimersByTimeAsync(2999);
		expect(panel.destroy).not.toHaveBeenCalled();
		expect(electron.powerSaveBlocker.stop).not.toHaveBeenCalled();
		reconnect();
		await vi.advanceTimersByTimeAsync(2001);
		expect(panel.destroy).not.toHaveBeenCalled();
		expect(electron.powerSaveBlocker.start).toHaveBeenCalledOnce();
		lose();
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(2999);
		expect(electron.powerSaveBlocker.stop).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(electron.powerSaveBlocker.stop).toHaveBeenCalledExactlyOnceWith(7);
		await vi.advanceTimersByTimeAsync(1999);
		expect(panel.destroy).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(panel.destroy).toHaveBeenCalledOnce();
		reconnect();
		await vi.advanceTimersByTimeAsync(0);
		const replacement = electron.BrowserWindow.windows.at(-1);
		expect(replacement).not.toBe(panel);
		expect(replacement?.showInactive).toHaveBeenCalled();
		expect(electron.powerSaveBlocker.start).toHaveBeenCalledTimes(2);
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

	it("awaits weather/media and monitor disposal through repeated quit requests", async () => {
		const weather = vi.mocked(registerWeatherMedia).mock.results[0]?.value;
		const monitor = vi.mocked(registerMonitor).mock.results[0]?.value;
		const voice = vi.mocked(registerVoiceSurface).mock.results[0]?.value;
		if (!weather || !monitor || !voice)
			throw new Error("Shared owners must register");
		let finishWeather = () => {};
		let finishMonitor = () => {};
		const weatherClosed = new Promise<void>((resolve) => {
			finishWeather = resolve;
		});
		const monitorClosed = new Promise<void>((resolve) => {
			finishMonitor = resolve;
		});
		vi.mocked(weather.dispose).mockImplementationOnce(() => weatherClosed);
		vi.mocked(monitor.dispose).mockImplementationOnce(() => monitorClosed);
		try {
			expect(appEvent("before-quit").preventDefault).toHaveBeenCalledOnce();
			await vi.waitFor(() => expect(weather.dispose).toHaveBeenCalledOnce());
			expect(monitor.dispose).not.toHaveBeenCalled();
			expect(electron.app.quit).not.toHaveBeenCalled();
			expect(appEvent("before-quit").preventDefault).toHaveBeenCalledOnce();
			finishWeather();
			await vi.waitFor(() => expect(monitor.dispose).toHaveBeenCalledOnce());
			expect(electron.app.quit).not.toHaveBeenCalled();
			finishMonitor();
			await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalledOnce());
			expect(voice.dispose).toHaveBeenCalledOnce();
			expect(weather.dispose).toHaveBeenCalledOnce();
			expect(monitor.dispose).toHaveBeenCalledOnce();
		} finally {
			finishWeather();
			finishMonitor();
		}
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

	it("awaits meeting recorder disposal before shared writers and quit", async () => {
		const meetings = vi.mocked(registerMeetings).mock.results[0]?.value;
		const monitor = vi.mocked(registerMonitor).mock.results[0]?.value;
		if (!meetings || !monitor) throw new Error("Missing shared owner");
		let release = () => {};
		vi.mocked(meetings.dispose).mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		appEvent("before-quit");
		await vi.waitFor(() => expect(meetings.dispose).toHaveBeenCalledOnce());
		try {
			expect(monitor.dispose).not.toHaveBeenCalled();
			expect(electron.app.quit).not.toHaveBeenCalled();
			appEvent("before-quit");
			expect(meetings.dispose).toHaveBeenCalledOnce();
		} finally {
			release();
		}
		await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalledOnce());
		expect(monitor.dispose).toHaveBeenCalledOnce();
	});

	it("awaits voice disposal after knob and monitor before releasing quit", async () => {
		const agentHttp = await vi.mocked(registerAgentHttp).mock.results[0]?.value;
		const voice = vi.mocked(registerVoiceSurface).mock.results[0]?.value;
		const knob = vi.mocked(registerKnob).mock.results[0]?.value;
		const monitor = vi.mocked(registerMonitor).mock.results[0]?.value;
		const profiles = vi.mocked(registerProfiles).mock.results[0]?.value;
		if (!voice || !knob || !monitor || !profiles || !agentHttp)
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
			expect(agentHttp.dispose).toHaveBeenCalledOnce();
			expect(
				vi.mocked(agentHttp.dispose).mock.invocationCallOrder[0],
			).toBeLessThan(vi.mocked(voice.dispose).mock.invocationCallOrder[0] ?? 0);
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

	it("continues cleanup after a registration failure and awaits graph disposal", async () => {
		const weather = vi.mocked(registerWeatherMedia).mock.results[0]?.value;
		const profiles = vi.mocked(registerProfiles).mock.results[0]?.value;
		const application = vi.mocked(makeDesktopRuntime).mock.results[0]?.value;
		if (!weather || !profiles || !application)
			throw new Error("Missing application owner");
		vi.mocked(weather.dispose).mockRejectedValueOnce(
			new Error("synthetic cleanup failure"),
		);
		const dispose = application.dispose.bind(application);
		let release = () => {};
		const finalizer = new Promise<void>((resolve) => {
			release = resolve;
		});
		const ownerDisposal = vi
			.spyOn(application, "dispose")
			.mockImplementation(async () => {
				await finalizer;
				await dispose();
			});
		appEvent("before-quit");
		await vi.waitFor(() => expect(ownerDisposal).toHaveBeenCalledOnce());
		try {
			expect(profiles.dispose).toHaveBeenCalledOnce();
			expect(electron.app.quit).not.toHaveBeenCalled();
			appEvent("before-quit");
			expect(ownerDisposal).toHaveBeenCalledOnce();
		} finally {
			release();
		}
		await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalledOnce());
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
	FAKE_QUAKE_DEVICE,
	type FakeHidTransport,
	makeFakeHidTransport,
} from "@open-quake/device/fake";
import { Deferred, Effect, type Layer, Schema } from "effect";

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

	it("restores saved bounds before presenting a replacement management window", async () => {
		const root = await mkdtemp(join(tmpdir(), "oq-settings-reopen-"));
		const bounds = { x: 100, y: 100, width: 800, height: 600 };
		electron.app.getPath.mockImplementation(() => root);
		await writeFile(
			join(root, "settings-v1.json"),
			JSON.stringify({
				version: 1,
				revision: 2,
				locale: "en",
				general: {
					version: 1,
					launchAtLogin: false,
					startHidden: true,
					window: bounds,
				},
			}),
		);
		try {
			await start();
			await vi.waitFor(() =>
				expect(windows().management.setBounds).toHaveBeenCalledWith(bounds),
			);
			const old = windows().management;
			old.destroyed = true;
			appEvent("activate");
			const replacement = electron.BrowserWindow.getAllWindows().find(
				(window) => window.options.title === "open-quake — management",
			);
			if (!replacement) throw new Error("Management must reopen");
			await vi.waitFor(() => expect(replacement.focus).toHaveBeenCalledOnce());
			expect(replacement.setBounds).toHaveBeenCalledWith(bounds);
			expect(replacement.setBounds.mock.invocationCallOrder[0]).toBeLessThan(
				replacement.show.mock.invocationCallOrder[0] ?? 0,
			);
		} finally {
			appEvent("before-quit");
			await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
			await rm(root, { recursive: true, force: true });
		}
	});

	async function startTwoStrips() {
		const two = await Effect.runPromise(makeTwoStrips);
		native.layer = two.layer;
		const primary = makeDisplay();
		const a = makeDisplay({
			id: 2,
			label: "DK-QUAKE",
			size: { width: 1920, height: 480 },
		});
		const b = makeDisplay({
			...a,
			id: 3,
			bounds: { x: 1920, y: 0, width: 1920, height: 480 },
		});
		electron.screen.getAllDisplays.mockReturnValue([primary, a]);
		await import("./index");
		await vi.waitFor(() =>
			expect(
				electron.BrowserWindow.windows
					.filter((w) => w.options.title === "open-quake panel")
					.at(-1)?.setBounds,
			).toHaveBeenLastCalledWith(a.bounds),
		);
		await vi.waitFor(() =>
			expect(windows().management.webContents.send).toHaveBeenCalledWith(
				"quake:diagnostic",
				expect.objectContaining({ hdmi: "pass", checking: false }),
			),
		);
		const first = electron.BrowserWindow.windows
			.filter((w) => w.options.title === "open-quake panel")
			.at(-1);
		two.devices.push(two.b);
		electron.screen.getAllDisplays.mockReturnValue([primary, a, b]);
		await vi.advanceTimersByTimeAsync(1000);
		await vi.waitFor(() =>
			expect(
				electron.BrowserWindow.windows
					.filter((w) => w.options.title === "open-quake panel")
					.at(-1)?.setBounds,
			).toHaveBeenLastCalledWith(b.bounds),
		);
		const second = electron.BrowserWindow.windows
			.filter((w) => w.options.title === "open-quake panel")
			.at(-1);
		if (!first || !second) throw new Error("Two panels required");
		return { two, primary, a, b, first, second };
	}
	it("routes secondary touch and knob input to its own panel and input consumers", async () => {
		vi.useFakeTimers();
		try {
			const { two, first, second } = await startTwoStrips();
			expect(second).not.toBe(first);
			const knob = vi.mocked(registerKnob).mock.results.at(-1)?.value;
			first?.webContents.send.mockClear();
			second?.webContents.send.mockClear();
			vi.mocked(knob?.onDevice ?? vi.fn()).mockClear();
			await Effect.runPromise(two.second.emit(report(3, 1, [1])));
			await Effect.runPromise(
				two.second.emit(report(0xa3, 26, [1, 2, 0x34, 1, 0x78, 5])),
			);
			await vi.waitFor(() =>
				expect(second?.webContents.send).toHaveBeenCalledWith("quake:event", {
					source: "hid",
					kind: "touch",
					points: [{ action: 2, x: 1400, y: 308 }],
				}),
			);
			expect(second?.webContents.send).toHaveBeenCalledWith("quake:event", {
				source: "hid",
				kind: "rotate",
				direction: 1,
			});
			expect(first?.webContents.send).not.toHaveBeenCalledWith(
				"quake:event",
				expect.objectContaining({ kind: "touch" }),
			);
			expect(first?.webContents.send).not.toHaveBeenCalledWith(
				"quake:event",
				expect.objectContaining({ kind: "rotate" }),
			);
			await vi.waitFor(() =>
				expect(knob?.onDevice).toHaveBeenCalledWith({
					source: "hid",
					kind: "rotate",
					direction: 1,
				}),
			);
			expect(vi.mocked(registerKnob).mock.calls.at(-1)?.[0]()).toBe(second);
		} finally {
			appEvent("before-quit");
			await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
			vi.useRealTimers();
		}
	});

	it("enrolls each strip and uses the selected serial hardware with scoped cleanup", async () => {
		vi.useFakeTimers();
		try {
			const { two } = await startTwoStrips();
			const profiles = vi.mocked(registerProfiles).mock.results.at(-1)?.value;
			await vi.waitFor(() =>
				expect(profiles?.connect).toHaveBeenCalledWith("B"),
			);
			expect(profiles?.connect).toHaveBeenCalledWith("A");
			const bindings = vi.mocked(registerKnob).mock.calls.at(-1)?.[2];
			await Effect.runPromise(two.second.emit(report(3, 1, [1])));
			await vi.waitFor(() => expect(bindings?.deviceId?.()).toBe("B"));
			const second = bindings?.hardware?.();
			if (!second) throw new Error("Secondary hardware must be attached");
			expect(await Effect.runPromise(second.snapshot())).toMatchObject({
				serial: "B",
			});
			await Effect.runPromise(two.first.emit(report(3, 1, [1])));
			await vi.waitFor(() => expect(bindings?.deviceId?.()).toBe("A"));
			const first = bindings?.hardware?.();
			if (!first) throw new Error("Primary hardware must remain attached");
			expect(await Effect.runPromise(first.snapshot())).toMatchObject({
				serial: "A",
			});
			const lockA = vi.spyOn(first, "setLocked");
			const lockB = vi.spyOn(second, "setLocked");
			for (const [event, listener] of electron.powerMonitor.on.mock.calls) {
				if (event === "lock-screen") listener();
			}
			await vi.waitFor(() => {
				expect(lockA).toHaveBeenCalledWith(true);
				expect(lockB).toHaveBeenCalledWith(true);
			});

			two.devices.splice(1, 1);
			await vi.advanceTimersByTimeAsync(1000);
			await vi.waitFor(() =>
				expect(profiles?.disconnect).toHaveBeenCalledWith("B"),
			);
			expect(profiles?.disconnect).not.toHaveBeenCalledWith("A");
			expect(await Effect.runPromise(two.second.closes)).toBe(1);
			expect(bindings?.hardware?.()).toBe(first);
			appEvent("before-quit");
			await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
			expect(profiles?.disconnect).toHaveBeenCalledWith("A");
		} finally {
			appEvent("before-quit");
			await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
			vi.useRealTimers();
		}
	});

	it("reroutes shared panel consumers when the selected strip closes", async () => {
		vi.useFakeTimers();
		try {
			const { two, first, second } = await startTwoStrips();
			const removed = second;
			const remaining = first;
			const lostBus = two.second;
			const liveBus = two.first;
			await Effect.runPromise(lostBus.emit(report(3, 1, [1])));
			const panel = vi.mocked(registerMonitor).mock.calls.at(-1)?.[2];
			await vi.waitFor(() => expect(panel?.()).toBe(removed));
			two.devices.splice(1, 1);
			await vi.advanceTimersByTimeAsync(1000);
			await vi.advanceTimersByTimeAsync(2500);
			expect(removed.isDestroyed()).toBe(false);
			await vi.advanceTimersByTimeAsync(2500);
			await vi.waitFor(() => expect(removed.isDestroyed()).toBe(true));
			expect(panel?.()).toBe(remaining);
			expect(remaining.isDestroyed()).toBe(false);
			expect(
				vi.mocked(registerVoiceSurface).mock.calls.at(-1)?.[0].panel(),
			).toBe(first);
			expect(vi.mocked(registerKnob).mock.calls.at(-1)?.[2]?.deviceId?.()).toBe(
				"A",
			);
			expect(
				electron.BrowserWindow.getAllWindows().filter(
					(w) => w.options.title === "open-quake panel",
				),
			).toEqual([remaining]);
			remaining.webContents.send.mockClear();
			await Effect.runPromise(liveBus.emit(report(3, 1, [0])));
			await vi.waitFor(() =>
				expect(remaining.webContents.send).toHaveBeenCalledWith("quake:event", {
					source: "hid",
					kind: "rotate",
					direction: -1,
				}),
			);
		} finally {
			appEvent("before-quit");
			await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
			vi.useRealTimers();
		}
	});

	it("disposes the visible preview before handing its ownership to real hardware", async () => {
		vi.useFakeTimers();
		try {
			const two = await Effect.runPromise(makeTwoStrips);
			two.devices.length = 0;
			native.layer = two.layer;
			await import("./index");
			await vi.waitFor(() =>
				expect(windows().panel.showInactive).toHaveBeenCalled(),
			);
			const preview = windows().panel;
			two.devices.push(two.a);
			const strip = makeDisplay({
				id: 2,
				label: "DK-QUAKE",
				size: { width: 1920, height: 480 },
			});
			electron.screen.getAllDisplays.mockReturnValue([makeDisplay(), strip]);
			await vi.advanceTimersByTimeAsync(1000);
			await vi.waitFor(() =>
				expect(
					vi.mocked(registerProfiles).mock.results.at(-1)?.value.connect,
				).toHaveBeenCalledWith("A"),
			);
			await vi.waitFor(() => expect(preview.isDestroyed()).toBe(true));
			const panels = electron.BrowserWindow.getAllWindows().filter(
				(w) => w.options.title === "open-quake panel",
			);
			expect(panels).toHaveLength(1);
			expect(panels[0]?.setBounds).toHaveBeenLastCalledWith(strip.bounds);
			expect(vi.mocked(registerMonitor).mock.calls.at(-1)?.[2]()).toBe(
				panels[0],
			);
		} finally {
			appEvent("before-quit");
			await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
			vi.useRealTimers();
		}
	});

	it("enrolls the real serial for the native connection lifetime and reconnects", async () => {
		fake = await Effect.runPromise(
			makeFakeHidTransport([
				{ ...FAKE_QUAKE_DEVICE, serialNumber: "FAKE-QUAKE-001" },
			]),
		);
		native.layer = fake.layer;
		await start();
		const profiles = vi.mocked(registerProfiles).mock.results.at(-1)?.value;
		await vi.waitFor(() =>
			expect(profiles?.connect).toHaveBeenCalledWith("FAKE-QUAKE-001"),
		);
		await Effect.runPromise(fake.failRead(new Error("synthetic disconnect")));
		await vi.waitFor(() =>
			expect(profiles?.disconnect).toHaveBeenCalledWith("FAKE-QUAKE-001"),
		);
		await vi.waitFor(() => expect(profiles?.connect).toHaveBeenCalledTimes(2), {
			timeout: 3500,
		});
		appEvent("before-quit");
		await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
		expect(profiles?.disconnect).toHaveBeenCalledTimes(2);
	});

	it("enrolls and cleans up the serial when saved hardware preferences are corrupt", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "quake-corrupt-preferences-"),
		);
		const serial = "FAKE-QUAKE-CORRUPT";
		await mkdir(join(directory, "hardware-v1"));
		await writeFile(
			join(
				directory,
				"hardware-v1",
				`${createHash("sha256").update(serial).digest("hex")}.json`,
			),
			"{invalid",
		);
		const path = electron.app.getPath.mockImplementation(() => directory);
		fake = await Effect.runPromise(
			makeFakeHidTransport([{ ...FAKE_QUAKE_DEVICE, serialNumber: serial }]),
		);
		native.layer = fake.layer;
		try {
			await start();
			const profiles = vi.mocked(registerProfiles).mock.results.at(-1)?.value;
			await vi.waitFor(() =>
				expect(profiles?.connect).toHaveBeenCalledExactlyOnceWith(serial),
			);
			appEvent("before-quit");
			await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
			expect(profiles?.disconnect).toHaveBeenCalledExactlyOnceWith(serial);
			expect(await Effect.runPromise(fake.closes)).toBe(1);
		} finally {
			path.mockImplementation(() => join(tmpdir(), "open-quake-window-test"));
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("settles discovery and restores the known strip after resume reopens HID", async () => {
		const primary = makeDisplay();
		const strip = makeDisplay({
			id: 2,
			label: "DK-QUAKE",
			size: { width: 480, height: 1920 },
			bounds: { x: -480, y: 0, width: 480, height: 1920 },
		});
		electron.screen.getAllDisplays.mockReturnValue([primary, strip]);
		await start();
		const { panel, management } = windows();
		await vi.waitFor(() => expect(panel.showInactive).toHaveBeenCalled());
		panel.showInactive.mockClear();
		const resume: (() => void) | undefined =
			electron.powerMonitor.on.mock.calls.find(
				([event]) => event === "resume",
			)?.[1];
		expect(resume).toBeDefined();
		resume?.();
		await vi.waitFor(
			async () => expect(await Effect.runPromise(fake.opens)).toBe(2),
			{ timeout: 7000 },
		);
		await vi.waitFor(() => {
			const diagnostic = management.webContents.send.mock.calls
				.filter(([channel]) => channel === "quake:diagnostic")
				.at(-1)?.[1];
			expect(diagnostic).toMatchObject({
				usb: "pass",
				hdmi: "pass",
				checking: false,
				issue: "none",
			});
			expect(panel.showInactive).toHaveBeenCalled();
		});
	}, 12000);

	it("defaults to HID, forwards to both windows, cleans up unplug and reconnects", async () => {
		await start();
		const profiles = vi.mocked(registerProfiles).mock.results.at(-1)?.value;
		expect(profiles?.resetKeys).not.toHaveBeenCalled();
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
		await vi.waitFor(() => expect(profiles?.resetKeys).toHaveBeenCalled());
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
			label: "Unnamed strip candidate",
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
			await vi.waitFor(() => expect(management.show).toHaveBeenCalledOnce());
			management.show.mockClear();
			management.destroyed = state === "destroyed";
			management.isMinimized.mockReturnValue(state === "minimized");
			appEvent("activate");
			const reopened = electron.BrowserWindow.getAllWindows().find(
				(window) => window !== panel,
			);
			expect(reopened).toBeDefined();
			expect(panel.destroyed).toBe(false);
			await vi.waitFor(() => expect(reopened?.show).toHaveBeenCalledOnce());
			expect(reopened?.focus).toHaveBeenCalledOnce();
			if (state === "destroyed") {
				expect(reopened).not.toBe(management);
				expect(reopened?.loadFile).toHaveBeenCalledOnce();
			} else expect(reopened).toBe(management);
			if (state === "minimized")
				expect(management.restore).toHaveBeenCalledOnce();
			appEvent("before-quit");
			await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
			electron.app.isPackaged = false;
			vi.unstubAllEnvs();
		},
	);
});
