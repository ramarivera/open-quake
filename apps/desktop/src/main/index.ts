import { join } from "node:path";
import { app, BrowserWindow, type Display, screen } from "electron";
import { type QuakeEvent, startDeviceBus } from "./deviceBus";
import { findPanelDisplay, PANEL_SIZE } from "./display";

const isDev = !!process.env.ELECTRON_RENDERER_URL;

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
		x: display.workArea.x,
		y: display.workArea.y,
		width: Math.min(PANEL_SIZE.width, display.workArea.width),
		height: Math.min(PANEL_SIZE.height, display.workArea.height),
		title: "open-quake panel",
		frame: false,
		fullscreenable: true,
		autoHideMenuBar: true,
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	loadSurface(win, "panel");
	return win;
}

function createManagementWindow(): BrowserWindow {
	const win = new BrowserWindow({
		width: 1100,
		height: 760,
		title: "open-quake — management",
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	loadSurface(win, "management");
	return win;
}

app.whenReady().then(() => {
	const displays = screen.getAllDisplays();
	const panelDisplay = findPanelDisplay(displays);
	const primary = screen.getPrimaryDisplay();

	const panelWin = createPanelWindow(panelDisplay ?? primary);
	const managementWin = createManagementWindow();

	const bus = startDeviceBus();
	const forward = (event: QuakeEvent): void => {
		for (const win of [panelWin, managementWin]) {
			if (!win.isDestroyed()) win.webContents.send("quake:event", event);
		}
	};
	bus.on(forward);

	app.on("before-quit", () => bus.stop());
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createManagementWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
