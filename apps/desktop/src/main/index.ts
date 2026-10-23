import { join } from "node:path";
import { QuakeDevice } from "@open-quake/device";
import { NodeHidLive } from "@open-quake/device/node-hid";
import { Effect, Fiber, Layer, ManagedRuntime } from "effect";
import { app, BrowserWindow, type Display, ipcMain, screen } from "electron";
import { QUAKE_EVENT_CHANNEL, QUAKE_STATUS_CHANNEL } from "../preload/quake";
import { type DeviceBus, startDeviceBus } from "./deviceBus";
import { findPanelDisplay, PANEL_SIZE } from "./display";
import { createEventForwarder } from "./eventForwarding";
import { MediaLive, registerMedia } from "./media";
import { startMockDeviceBus } from "./mockDeviceBus";

const isDev = !!process.env.ELECTRON_RENDERER_URL;
const PANEL_TITLE = "open-quake panel";

function panelBounds(display: Display) {
	return {
		x: display.workArea.x,
		y: display.workArea.y,
		width: Math.min(PANEL_SIZE.width, display.workArea.width),
		height: Math.min(PANEL_SIZE.height, display.workArea.height),
	};
}

function loadSurface(
	win: BrowserWindow,
	surface: "management" | "panel",
): void {
	if (isDev) {
		win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?surface=${surface}`);
	} else {
		win.loadFile(join(__dirname, "../renderer/index.html"), {
			query: { surface },
		});
	}
}

function createPanelWindow(display: Display): BrowserWindow {
	const win = new BrowserWindow({
		...panelBounds(display),
		title: PANEL_TITLE,
		frame: false,
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
	loadSurface(win, "panel");
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
	const getPanelDisplay = (): Display =>
		findPanelDisplay(screen.getAllDisplays()) ?? screen.getPrimaryDisplay();
	let panelWin = createPanelWindow(getPanelDisplay());
	let managementWin = createManagementWindow();
	registerMedia(
		ManagedRuntime.make(
			MediaLive(join(app.getPath("userData"), "wallpaper-v1")),
		),
		() => managementWin,
	);
	// One service layer for the main process. Only this Electron boundary runs it.
	const runtime = ManagedRuntime.make(
		QuakeDevice.DefaultWithoutDependencies.pipe(Layer.provide(NodeHidLive)),
	);
	const mock = isDev && process.env.OPEN_QUAKE_MOCK_DEVICE === "1";
	const source = mock
		? Effect.acquireRelease(Effect.sync(startMockDeviceBus), (bus) =>
				Effect.sync(() => bus.stop()),
			)
		: startDeviceBus();
	let bus: DeviceBus | undefined;
	let running: Fiber.RuntimeFiber<void, never> | undefined;
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
						bus.on(createEventForwarder(() => [panelWin, managementWin]));
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
				await runtime.runPromise(Fiber.interrupt(fiber));
				bus = undefined;
			});
		}
		return stopping;
	};
	const syncPanelDisplay = (): void => {
		const display = getPanelDisplay();
		if (panelWin.isDestroyed()) {
			panelWin = createPanelWindow(display);
		} else {
			panelWin.setBounds(panelBounds(display));
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
		void stopBus().then(async () => {
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
