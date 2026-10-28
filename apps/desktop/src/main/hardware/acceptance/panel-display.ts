/** Explicit native panel-display fixture. Never imported by the product or default tests. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
	app,
	BrowserWindow,
	type NativeImage,
	nativeImage,
	type Rectangle,
	screen,
} from "electron";
import { findPanelDisplay } from "../../display";
import { ownNativeDevice } from "./native-owner";
import { comparePanelPixels, type PanelBitmap } from "./panel-pixels";
import { acceptanceOptions } from "./policy";

assert.equal(
	process.platform,
	"darwin",
	"Panel capture uses macOS screencapture",
);
let stage = "configuration";
const options = acceptanceOptions(process.env);
// A failed load would otherwise leave Electron running with no window.
const owner = await ownNativeDevice(options.directory).catch(
	(cause: unknown) => {
		console.error(
			"QUAKE panel E2E failed",
			JSON.stringify({
				stage: "ownership",
				message: cause instanceof Error ? cause.message : "unknown",
			}),
		);
		app.exit(1);
		throw cause;
	},
);
const result = join(options.directory, "panel-result.json");
await writeFile(
	result,
	JSON.stringify({ id: "display", status: "incomplete" }),
	{
		flag: "wx",
		mode: 0o600,
	},
);
const userData = join(options.directory, "panel-user-data");
await mkdir(userData, { recursive: true, mode: 0o700 });
app.setPath("userData", userData);
app.setPath("sessionData", userData);
app.setActivationPolicy("accessory");
// Only the production panel may appear, inactive on the QUAKE display.
// Management and settings windows stay hidden and never take focus.
app.on("browser-window-created", (_event, window) => {
	window.show = () => {};
	window.focus = () => {};
});
const deadline = setTimeout(() => {
	process.stderr.write(`QUAKE panel E2E timed out at ${stage}\n`);
	app.exit(1);
}, 90_000);

const capture = async (bounds: Rectangle, name: string) => {
	const path = join(options.directory, name);
	await promisify(execFile)("screencapture", [
		"-x",
		`-R${bounds.x},${bounds.y},${bounds.width},${bounds.height}`,
		path,
	]);
	return nativeImage.createFromPath(path);
};
const bitmap = (image: NativeImage): PanelBitmap => {
	const small = image.resize({ width: 480, height: 120, quality: "good" });
	return { width: 480, height: 120, data: small.toBitmap() };
};

// Runs before the production ready handler schedules any panel work.
const desktop = new Promise<{ image: NativeImage; bounds: Rectangle }>(
	(resolve, reject) =>
		app.once("ready", () => {
			const display = findPanelDisplay(screen.getAllDisplays());
			if (!display) return reject(new Error("No unique QUAKE display"));
			capture(display.bounds, "desktop.png").then(
				(image) => resolve({ image, bounds: display.bounds }),
				reject,
			);
		}),
);

async function run() {
	stage = "production startup";
	await import("../../index");
	const before = await desktop;
	stage = "panel window";
	const end = Date.now() + 45_000;
	let panel: BrowserWindow | undefined;
	while (Date.now() < end && !panel) {
		panel = BrowserWindow.getAllWindows().find(
			(win) =>
				!win.isDestroyed() &&
				win.webContents.getURL().includes("surface=panel") &&
				win.isVisible() &&
				!win.webContents.isLoading() &&
				JSON.stringify(win.getBounds()) === JSON.stringify(before.bounds),
		);
		if (!panel) await delay(200);
	}
	assert(panel, "The panel never filled the QUAKE display");
	// Let the shield clear and the first frames settle.
	await delay(3_000);
	stage = "capture";
	const [shown, rendered] = await Promise.all([
		capture(before.bounds, "display.png"),
		panel.webContents.capturePage(),
	]);
	// Counts only: what the panel painted, without copying any user content.
	const content: unknown = await panel.webContents.executeJavaScript(
		`({tiles: document.querySelectorAll('[data-state="tile"]').length, keyed: document.querySelectorAll('[data-key-code]').length, images: document.querySelectorAll('.strip-panel img').length, textLength: (document.querySelector('.strip-panel')?.innerText ?? '').trim().length, panel: Boolean(document.querySelector('.strip-panel'))})`,
	);
	await writeFile(join(options.directory, "panel.png"), rendered.toPNG(), {
		mode: 0o600,
	});
	const evidence = comparePanelPixels(
		bitmap(shown),
		bitmap(rendered),
		bitmap(before.image),
	);
	await writeFile(
		result,
		JSON.stringify({
			id: "display",
			mode: "native",
			status: evidence.passed ? "passed" : "failed",
			bounds: before.bounds,
			evidence,
			content,
			limits:
				"Captures the macOS framebuffer sent to the QUAKE; it does not observe backlight or physical light output.",
		}),
		{ mode: 0o600 },
	);
	assert(evidence.passed, `Panel display mismatch ${JSON.stringify(evidence)}`);
	console.info(
		"QUAKE panel E2E PASS: the QUAKE display shows the rendered production panel",
	);
}

run().then(
	async () => {
		clearTimeout(deadline);
		await owner.close();
		app.quit();
	},
	async (cause: unknown) => {
		console.error(
			"QUAKE panel E2E failed",
			JSON.stringify({
				stage,
				message: cause instanceof Error ? cause.message : "unknown",
			}),
		);
		await owner.close();
		app.exit(1);
	},
);
