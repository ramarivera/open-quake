import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HardwareControls, QuakeDevice } from "@open-quake/device";
import { NodeHidLive } from "@open-quake/device/node-hid";
import { Effect, Fiber, Layer, ManagedRuntime, Stream } from "effect";
import { app, BrowserWindow, type Display, ipcMain, screen } from "electron";
import { KnobDispatchFailed } from "../../../../packages/device/src/knob/knob-errors.js";
import { ProfileService } from "../../../../packages/device/src/profiles/profile-service.js";
import { QUAKE_EVENT_CHANNEL, QUAKE_STATUS_CHANNEL } from "../preload/quake";
import { ClockLive, registerClock, registerClockScheme } from "./clock";
import { type DeviceBus, startDeviceBus } from "./deviceBus";
import {
	findPanelDisplay,
	type PanelRotation,
	panelBounds,
	panelRotation,
} from "./display";
import { createEventForwarder } from "./eventForwarding";
import { registerHardware } from "./hardware";
import { attachHardware, startMockHardwareBus } from "./hardware/bus";
import { hardwarePreferencesLive } from "./hardware/preferences";
import { registerKnob } from "./knob";
import { knobProfileBinding } from "./knob/profile-binding";
import { MediaLive, registerMedia } from "./media";
import { registerProfiles } from "./profiles";

const isDev = !!process.env.ELECTRON_RENDERER_URL;
const rendererURL =
	process.env.ELECTRON_RENDERER_URL ??
	pathToFileURL(join(__dirname, "../renderer/index.html")).href;
registerClockScheme();
const PANEL_TITLE = "open-quake panel";

interface PanelTarget {
	readonly display: Display;
	/** True when the display is the QUAKE strip, not a fallback. */
	readonly isPanel: boolean;
}

function loadSurface(
	win: BrowserWindow,
	surface: "management" | "panel",
	rotation: PanelRotation = 0,
): void {
	const query = { surface, rotation: String(rotation) };
	if (isDev) {
		win.loadURL(
			`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`,
		);
	} else {
		win.loadFile(join(__dirname, "../renderer/index.html"), { query });
	}
}

function placePanel(win: BrowserWindow, { display, isPanel }: PanelTarget) {
	win.setBounds(panelBounds(display, isPanel));
	// Cover the menu bar macOS draws on every display; only on the strip itself.
	win.setAlwaysOnTop(isPanel, "screen-saver");
}

function createPanelWindow(target: PanelTarget): BrowserWindow {
	const win = new BrowserWindow({
		...panelBounds(target.display, target.isPanel),
		title: PANEL_TITLE,
		frame: false,
		// An NSPanel is not a standard window, so tiling managers leave the strip
		// alone. The fallback stays a normal window on the current Space.
		...(target.isPanel && process.platform === "darwin"
			? { type: "panel" }
			: {}),
		resizable: false,
		enableLargerThanScreen: true,
		fullscreenable: true,
		autoHideMenuBar: true,
		webPreferences: {
			preload: join(__dirname, "../preload/index.mjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	// OmniWM matches this title even while HTML/navigation titles change.
	win.on("page-title-updated", (event) => event.preventDefault());
	placePanel(win, target);
	loadSurface(win, "panel", panelRotation(target.display, target.isPanel));
	return win;
}

function createManagementWindow(): BrowserWindow {
	const win = new BrowserWindow({
		width: 1100,
		height: 760,
		title: "open-quake — management",
		webPreferences: {
			preload: join(__dirname, "../preload/index.mjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	loadSurface(win, "management");
	return win;
}

app.whenReady().then(() => {
	const getPanelTarget = (): PanelTarget => {
		const display = findPanelDisplay(screen.getAllDisplays());
		return display
			? { display, isPanel: true }
			: { display: screen.getPrimaryDisplay(), isPanel: false };
	};
	let panelTarget = getPanelTarget();
	let panelWin = createPanelWindow(panelTarget);
	let managementWin = createManagementWindow();
	let bus: DeviceBus | undefined;
	registerMedia(
		ManagedRuntime.make(
			MediaLive(join(app.getPath("userData"), "wallpaper-v1")),
		),
		() => managementWin,
	);
	registerClock(
		ManagedRuntime.make(ClockLive(app.getPath("userData"))),
		() => managementWin,
	);
	// One service layer for the main process. Only this Electron boundary runs it.
	const runtime = ManagedRuntime.make(
		Layer.merge(
			QuakeDevice.DefaultWithoutDependencies.pipe(Layer.provide(NodeHidLive)),
			HardwareControls.DefaultWithoutDependencies.pipe(
				Layer.provide(
					hardwarePreferencesLive(join(app.getPath("userData"), "hardware-v1")),
				),
			),
		),
	);
	const mock = process.env.OPEN_QUAKE_MOCK_DEVICE === "1";
	const managementURL = new URL(rendererURL);
	managementURL.searchParams.set("surface", "management");
	managementURL.searchParams.set("rotation", "0");
	const profiles = registerProfiles(
		() => managementWin,
		rendererURL,
		undefined,
		managementURL.href,
	);
	const knob = registerKnob(
		() => panelWin,
		() => [panelWin, managementWin],
		{
			profiles: knobProfileBinding(profiles.runtime, profiles.select),
			hardware: () => bus?.hardware?.(),
		},
	);
	const profileUpdates = profiles.runtime.runFork(
		ProfileService.subscribeCommittedProfiles().pipe(
			Effect.flatMap((snapshots) =>
				Stream.runForEach(snapshots, () =>
					Effect.tryPromise({
						try: () => knob.refresh(),
						catch: KnobDispatchFailed.fromCause,
					}).pipe(
						Effect.catchTag("KnobDispatchFailed", (error) =>
							Effect.logWarning("Refreshing knob profiles failed", {
								code: error.code,
							}),
						),
					),
				),
			),
		),
	);
	const source = mock
		? startMockHardwareBus()
		: Effect.gen(function* () {
				const controls = yield* HardwareControls;
				return yield* startDeviceBus((connection) =>
					attachHardware(controls, connection),
				);
			});
	const disposeHardware = registerHardware(
		() => bus?.hardware?.(),
		() => managementWin,
		mock,
	);
	let running:
		| Fiber.RuntimeFiber<void, Effect.Effect.Error<typeof source>>
		| undefined;
	let stopping = Promise.resolve();
	let generation = 0;
	let quitting = false;
	let quitFinished = false;
	const startBus = (): void => {
		if (running || quitting) return;
		const requested = ++generation;
		// A reopened window waits for the old scope's native close to finish.
		void stopping.then(() => {
			if (quitting || requested !== generation || running) return;
			running = runtime.runFork(
				Effect.scoped(
					Effect.gen(function* () {
						bus = yield* source;
						bus.on(
							createEventForwarder(
								() => [panelWin, managementWin],
								() => [panelWin],
							),
						);
						if (mock)
							bus.on((event) => {
								if (event.kind === "status") {
									const operation =
										event.state === "connected"
											? profiles.connect("desktop-preview")
											: profiles.disconnect("desktop-preview");
									void operation.catch(() => {});
								}
							});

						bus.on(knob.onDevice);
						yield* Effect.never;
					}),
				),
			);
		});
	};
	const stopBus = (): Promise<void> => {
		generation++;
		bus = undefined;
		const fiber = running;
		running = undefined;
		if (fiber) {
			stopping = stopping.then(async () => {
				if (mock) await profiles.disconnect("desktop-preview");
				await runtime.runPromise(Fiber.interrupt(fiber));
				bus = undefined;
			});
		}
		return stopping;
	};
	const syncPanelDisplay = (): void => {
		const previous = panelTarget;
		panelTarget = getPanelTarget();
		if (panelWin.isDestroyed()) {
			panelWin = createPanelWindow(panelTarget);
		} else if (panelTarget.isPanel !== previous.isPanel) {
			// The window type is fixed at creation; swap before closing the old one
			// so the bus never sees zero windows.
			const old = panelWin;
			panelWin = createPanelWindow(panelTarget);
			old.destroy();
		} else {
			placePanel(panelWin, panelTarget);
			const rotation = panelRotation(panelTarget.display, panelTarget.isPanel);
			if (rotation !== panelRotation(previous.display, previous.isPanel))
				loadSurface(panelWin, "panel", rotation);
		}
		startBus();
	};
	screen.on("display-added", syncPanelDisplay);
	screen.on("display-removed", syncPanelDisplay);
	screen.on("display-metrics-changed", syncPanelDisplay);

	startBus();
	// Preload asks after registering its listener, including after reloads.
	const sendStatus = (event: Electron.IpcMainEvent): void => {
		const status = bus?.currentStatus();
		if (status && !event.sender.isDestroyed()) {
			event.sender.send(QUAKE_EVENT_CHANNEL, status);
		}
	};
	ipcMain.on(QUAKE_STATUS_CHANNEL, sendStatus);

	app.on("before-quit", (event) => {
		if (quitFinished) return;
		// Electron does not await async listeners. Keep it alive for HID finalizers.
		event.preventDefault();
		if (quitting) return;
		quitting = true;
		screen.removeListener("display-added", syncPanelDisplay);
		screen.removeListener("display-removed", syncPanelDisplay);
		screen.removeListener("display-metrics-changed", syncPanelDisplay);
		ipcMain.removeListener(QUAKE_STATUS_CHANNEL, sendStatus);
		disposeHardware();
		void stopBus().then(async () => {
			if (profileUpdates)
				await profiles.runtime.runPromise(Fiber.interrupt(profileUpdates));
			await knob.dispose();
			await profiles.dispose();
			await runtime.dispose();
			quitFinished = true;
			app.quit();
		});
	});
	app.on("activate", () => {
		if (quitting) return;
		if (BrowserWindow.getAllWindows().length === 0) {
			syncPanelDisplay();
			managementWin = createManagementWindow();
			startBus();
		}
	});
	app.on("window-all-closed", () => {
		void stopBus();
		if (process.platform !== "darwin") app.quit();
	});
});
