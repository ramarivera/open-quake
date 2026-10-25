import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, BrowserWindow, ipcMain } from "electron";
import { MAINTENANCE_CHANNEL } from "../../shared/maintenance-contracts";
import { MANAGEMENT_THEME } from "../../shared/management";
import { PROFILE_REQUEST } from "../../shared/profile-manager";

export async function runPackageSmoke(): Promise<void> {
	const deadline = setTimeout(() => app.exit(1), 25_000);
	try {
		const scratch = process.env.PACKAGE_SMOKE_DATA;
		assert.ok(scratch, "The smoke runner must supply isolated user data");
		app.setPath("userData", scratch);
		app.setPath("sessionData", scratch);
		if (process.platform === "darwin") app.setActivationPolicy("prohibited");
		app.disableHardwareAcceleration();
		await app.whenReady();
		assert.equal(app.isPackaged, true);
		assert.equal(app.getVersion(), process.env.RELEASE_VERSION);
		assert.equal(process.arch, process.env.RELEASE_ARCH);
		const require = createRequire(join(app.getAppPath(), "package.json"));
		const hid = require.resolve("node-hid");
		// Load the binding directly: node-hid otherwise defers this until the
		// first enumeration/open. No HID discovery or device connection occurs.
		const hidRequire = createRequire(hid);
		const binding = hidRequire("pkg-prebuilds/bindings")(dirname(hid), {
			name: process.platform === "linux" ? "HID_hidraw" : "HID",
			napi_versions: [4],
		});
		assert.equal(typeof binding.devices, "function");
		assert.equal(require("koffi").sizeof("int"), 4);
		let previewRequested = false;
		ipcMain.handle(PROFILE_REQUEST, () => {
			previewRequested = true;
			return { _tag: "rejected", reason: "Isolated packaging smoke" };
		});
		ipcMain.handle(MANAGEMENT_THEME, () => undefined);
		ipcMain.handle(MAINTENANCE_CHANNEL, () => ({ ok: true }));
		const win = new BrowserWindow({
			show: false,
			webPreferences: {
				preload: join(app.getAppPath(), "out/preload/index.mjs"),
				sandbox: false,
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
		const failures: string[] = [];
		win.webContents.on("preload-error", (_event, _path, error) =>
			failures.push(error.message),
		);
		win.webContents.on("render-process-gone", (_event, details) =>
			failures.push(details.reason),
		);
		await win.loadFile(join(app.getAppPath(), "out/renderer/index.html"), {
			query: { surface: "profile-thumbnail", locale: "en" },
		});
		let rendered = false;
		for (let attempt = 0; attempt < 100 && !rendered; attempt++) {
			rendered = await win.webContents.executeJavaScript(
				`document.querySelector('#root')?.textContent === 'No preview'
				&& typeof window.openQuake?.onQuakeEvent === 'function'
				&& typeof window.quakeProfileManager?.request === 'function'`,
			);
			if (!rendered) await delay(50);
		}
		assert.equal(rendered, true, "Packaged renderer and preload must boot");
		assert.equal(
			previewRequested,
			true,
			"Packaged preload must reach main IPC",
		);
		assert.deepEqual(failures, []);
		win.destroy();
		ipcMain.removeHandler(PROFILE_REQUEST);
		ipcMain.removeHandler(MANAGEMENT_THEME);
		ipcMain.removeHandler(MAINTENANCE_CHANNEL);
		console.info(
			`PACKAGE_SMOKE_PASS ${process.platform} ${process.arch} ${app.getVersion()}`,
		);
		clearTimeout(deadline);
		app.exit(0);
	} catch (error) {
		console.error(error);
		clearTimeout(deadline);
		app.exit(1);
	}
}
