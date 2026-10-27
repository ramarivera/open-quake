import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

// Match Electron's canonical userData path while preserving storage symlink checks.
const directory = realpathSync(
	mkdtempSync(join(tmpdir(), "open-quake-bundle-")),
);
const mockMode = process.argv.includes("--mock");
const app = new EventEmitter();
app.isPackaged = true;
app.commandLine = { appendSwitch() {} };
app.setAppUserModelId = () => {};
app.relaunch = () => {};
app.requestSingleInstanceLock = () => true;
app.whenReady = () => Promise.resolve();
app.getPath = () => directory;
app.getVersion = () => "0.0.0";
app.getLocale = () => "en-US";
let quit = false;
app.quit = () => {
	let prevented = false;
	app.emit("before-quit", {
		preventDefault() {
			prevented = true;
		},
	});
	if (!prevented) quit = true;
};
const events = [];
class Window extends EventEmitter {
	static windows = [];
	static getAllWindows() {
		return Window.windows;
	}
	constructor(options) {
		super();
		this.options = options;
		Window.windows.push(this);
	}
	url = "";
	webContents = Object.assign(new EventEmitter(), {
		setWindowOpenHandler: () => {},
		session: Object.assign(new EventEmitter(), {
			setDevicePermissionHandler: () => {},
		}),
		setAudioMuted: () => {},
		setZoomFactor: () => {},
		send: (channel, event) => events.push({ channel, event }),
		isDestroyed: () => false,
		getURL: () => this.url,
	});
	isDestroyed() {
		return false;
	}
	loadFile(path) {
		this.url = pathToFileURL(path).href;
	}
	loadURL(url) {
		this.url = url;
	}
	hide() {
		this.shown = false;
	}
	isMinimized() {
		return this.minimized;
	}
	restores = 0;
	restore() {
		this.minimized = false;
		this.restores++;
	}
	focused = false;
	focus() {
		this.focused = true;
	}
	minimized = false;
	minimize() {
		this.minimized = true;
		this.shown = false;
	}
	shown = false;
	isVisible() {
		return this.shown;
	}
	show() {
		this.shown = true;
	}
	showInactive() {
		this.shown = true;
	}
	isMaximized() {
		return false;
	}
	isFullScreen() {
		return false;
	}
	getBounds() {
		return { x: 0, y: 0, width: 1100, height: 760 };
	}
	setBounds() {}
	setAlwaysOnTop() {}
	setOpacity() {}
	moveTop() {}
	setIgnoreMouseEvents() {}
	setVisibleOnAllWorkspaces() {}
	destroy() {}
}
class Tray extends EventEmitter {
	setToolTip() {}
	setContextMenu() {}
	destroy() {
		this.removeAllListeners();
	}
}
const screen = new EventEmitter();
const display = {
	id: 1,
	scaleFactor: 1,
	label: "Primary",
	size: { width: 1920, height: 1080 },
	workArea: { x: 0, y: 0, width: 1920, height: 1080 },
	bounds: { x: 0, y: 0, width: 1920, height: 1080 },
};
screen.getAllDisplays = () => [display];
screen.getPrimaryDisplay = () => display;
const powerMonitor = new EventEmitter();
const powerSaveBlocker = { start: () => 1, stop: () => {} };
const ipcMain = new EventEmitter();
const requests = new Map();
ipcMain.handle = (channel, handler) => {
	assert(!requests.has(channel), `Duplicate request owner: ${channel}`);
	requests.set(channel, handler);
};
ipcMain.removeHandler = (channel) => requests.delete(channel);
// Wallpaper media only touches these on user action; the smoke never triggers one.
const dialog = {
	showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
};
const nativeImage = {
	createFromBitmap: () => ({ setTemplateImage() {} }),
	createFromBuffer: () => {
		throw new Error("Bundle smoke must not decode images");
	},
};
const clipboard = new Proxy(
	{},
	{
		get() {
			throw new Error("Bundle smoke must not access the clipboard");
		},
	},
);
const shell = { openExternal: () => Promise.resolve() };
// The clock registers its media scheme before ready and a handler after.
const schemes = [];
const protocol = {
	registerSchemesAsPrivileged: (list) => schemes.push(...list),
	handle: () => {},
	unhandle: () => {},
};
const net = {
	fetch: () => {
		throw new Error("Bundle smoke must not serve clock media");
	},
};
const nativeTheme = { themeSource: "system" };
const safeStorage = { isEncryptionAvailable: () => false };
const desktopCapturer = {
	getSources: () => {
		throw new Error("Bundle smoke must never capture screens");
	},
};
const systemPreferences = {
	askForMediaAccess: () => {
		throw new Error("Bundle smoke must never request audio access");
	},
	getMediaAccessStatus: () => "denied",
};
const webContents = { fromFrame: () => undefined };
const session = { defaultSession: { webRequest: { onBeforeRequest() {} } } };
globalThis.openQuakeBundleSmoke = {
	webContents,
	desktopCapturer,
	systemPreferences,
	powerMonitor,
	powerSaveBlocker,
	nativeTheme,
	safeStorage,
	shell,
	app,
	BrowserWindow: Window,
	screen,
	ipcMain,
	dialog,
	nativeImage,
	Tray,
	protocol,
	net,
	session,
	clipboard,
};
let nativeResolutions = 0;
let enumerations = 0;
globalThis.openQuakeSmokeDiscovery = () => {
	enumerations++;
	return [];
};
const virtualModule = (source) => ({
	url: `data:text/javascript,${encodeURIComponent(source)}`,
	shortCircuit: true,
});
const hooks = registerHooks({
	resolve(specifier, context, next) {
		if (specifier === "electron")
			return virtualModule(
				"export const { app, BrowserWindow, Menu, Tray, screen, ipcMain, dialog, nativeImage, powerMonitor, powerSaveBlocker, shell, protocol, net, session, nativeTheme, safeStorage, clipboard, desktopCapturer, systemPreferences, webContents } = globalThis.openQuakeBundleSmoke;",
			);
		if (specifier === "node-hid") {
			// Resolve the actual installed dependency before substituting hermetic I/O.
			assert.match(next(specifier, context).url, /node-hid/);
			nativeResolutions++;
			return virtualModule(
				"export const devicesAsync = async () => globalThis.openQuakeSmokeDiscovery(); export const HIDAsync = { open() { throw new Error('Hardware must never open in this smoke check'); } };",
			);
		}
		return next(specifier, context);
	},
});

async function until(check) {
	const deadline = Date.now() + 3000;
	while (!check()) {
		assert.ok(Date.now() < deadline, "Bundle smoke check timed out");
		await delay(10);
	}
}

try {
	delete process.env.ELECTRON_RENDERER_URL;
	// Default launch still uses HID. Explicit mock mode also works in built applications.
	if (mockMode) process.env.OPEN_QUAKE_MOCK_DEVICE = "1";
	else delete process.env.OPEN_QUAKE_MOCK_DEVICE;
	await import("../../../out/main/index.js");
	// Other main-process modules (wallpaper) broadcast too; this check owns device events.
	const quakeEvents = () =>
		events.filter(({ channel }) => channel === "quake:event");
	await until(() => quakeEvents().length >= 2);
	assert.equal(Window.windows.length, 2);
	for (const channel of [
		"settings:locale:rpc",
		"maintenance:request",
		"voice:request",
		"meetings:request",
		"agent-connections:request",
		"agent-http:conversations:request",
	])
		assert(requests.has(channel), `Missing request owner: ${channel}`);
	assert.equal(
		nativeResolutions,
		mockMode ? 0 : 1,
		"Default native package stays external; mock never loads it",
	);
	assert.equal(enumerations, mockMode ? 0 : 1);
	assert.deepEqual(
		schemes.map(({ scheme }) => scheme),
		["oq-clock-media"],
	);
	for (const { channel, event } of quakeEvents()) {
		assert.equal(channel, "quake:event");
		if (mockMode)
			assert.deepEqual(event, {
				source: "mock",
				kind: "status",
				state: "connected",
			});
		else {
			assert.deepEqual(event, {
				source: "hid",
				kind: "status",
				state: "error",
				error: {
					_tag: "QuakeDeviceNotFound",
					code: "QUAKE.DEVICE.NOT_FOUND",
					category: "unavailable",
				},
			});
		}
	}
	// Device events precede async settings restoration. Exercise a fully initialized app.
	await until(() =>
		Window.windows.some(
			(window) => window.options.title?.includes("management") && window.shown,
		),
	);
	const management = Window.windows.find((window) =>
		window.options.title?.includes("management"),
	);
	assert(management, "Management BrowserWindow exists");
	management.minimize();
	app.emit("activate");
	await until(() => management.shown);
	assert.equal(
		management.isMinimized(),
		false,
		"Activation restores a minimized BrowserWindow",
	);
	assert.equal(management.restores, 1);
	assert.equal(management.focused, true);

	app.quit();
	await until(() => quit);
	for (const channel of [
		"settings:locale:rpc",
		"maintenance:request",
		"voice:request",
		"meetings:request",
		"agent-connections:request",
		"agent-http:conversations:request",
	])
		assert(!requests.has(channel), `Request owner survived quit: ${channel}`);
	assert.equal(screen.listenerCount("display-added"), 0);
	assert.equal(ipcMain.listenerCount("quake:status"), 0);
	console.info(
		mockMode
			? "Bundle smoke passed: explicit mock works in built app; no native discovery or hardware I/O."
			: "Bundle smoke passed: default HID, typed absence delivered to both windows, external native resolution, awaited quit; no hardware I/O.",
	);
} finally {
	app.quit();
	hooks.deregister();
	delete globalThis.openQuakeBundleSmoke;
	delete globalThis.openQuakeSmokeDiscovery;
	rmSync(directory, { recursive: true, force: true });
}

if (!mockMode) {
	const child = spawnSync(
		process.execPath,
		[fileURLToPath(import.meta.url), "--mock"],
		{ stdio: "inherit", env: process.env },
	);
	assert.equal(child.status, 0, "Built mock-mode smoke must pass");
}
