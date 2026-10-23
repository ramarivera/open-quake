import { join } from "node:path";
import "./media";
import { app, BrowserWindow, type Display, screen } from "electron";
import { startDeviceBus } from "./deviceBus";
import { findPanelDisplay, PANEL_SIZE } from "./display";
import { createEventForwarder } from "./eventForwarding";

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
	const syncPanelDisplay = (): void => {
		const display = getPanelDisplay();
		if (panelWin.isDestroyed()) {
			panelWin = createPanelWindow(display);
		} else {
			panelWin.setBounds(panelBounds(display));
		}
	};
	screen.on("display-added", syncPanelDisplay);
	screen.on("display-removed", syncPanelDisplay);
	screen.on("display-metrics-changed", syncPanelDisplay);

	const bus = startDeviceBus();
	bus.on(createEventForwarder(() => [panelWin, managementWin]));

	app.on("before-quit", () => {
		screen.removeListener("display-added", syncPanelDisplay);
		screen.removeListener("display-removed", syncPanelDisplay);
		screen.removeListener("display-metrics-changed", syncPanelDisplay);
		bus.stop();
	});
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			syncPanelDisplay();
			managementWin = createManagementWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
