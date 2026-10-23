import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerHooks } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const app = new EventEmitter();
app.whenReady = () => Promise.resolve();
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
class Window {
	static windows = [];
	static getAllWindows() {
		return Window.windows;
	}
	constructor() {
		Window.windows.push(this);
	}
	webContents = {
		send: (channel, event) => events.push({ channel, event }),
		isDestroyed: () => false,
	};
	isDestroyed() {
		return false;
	}
	on() {}
	loadFile() {}
	setBounds() {}
}
const screen = new EventEmitter();
const display = {
	label: "Primary",
	size: { width: 1920, height: 1080 },
	workArea: { x: 0, y: 0, width: 1920, height: 1080 },
};
screen.getAllDisplays = () => [display];
screen.getPrimaryDisplay = () => display;
const ipcMain = new EventEmitter();
globalThis.openQuakeBundleSmoke = {
	app,
	BrowserWindow: Window,
	screen,
	ipcMain,
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
				"export const { app, BrowserWindow, screen, ipcMain } = globalThis.openQuakeBundleSmoke;",
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
	// A dev flag must not select synthetic input in a production launch.
	process.env.OPEN_QUAKE_MOCK_DEVICE = "1";
	await import("../../../out/main/index.js");
	await until(() => events.length >= 2);
	assert.equal(Window.windows.length, 2);
	assert.equal(nativeResolutions, 1, "Native package must remain external");
	assert.equal(enumerations, 1);
	for (const { channel, event } of events) {
		assert.equal(channel, "quake:event");
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
	app.quit();
	await until(() => quit);
	assert.equal(screen.listenerCount("display-added"), 0);
	assert.equal(ipcMain.listenerCount("quake:status"), 0);
	console.info(
		"Bundle smoke passed: default HID, typed absence delivered to both windows, external native resolution, awaited quit; no hardware I/O.",
	);
} finally {
	app.quit();
	hooks.deregister();
	delete globalThis.openQuakeBundleSmoke;
	delete globalThis.openQuakeSmokeDiscovery;
}
