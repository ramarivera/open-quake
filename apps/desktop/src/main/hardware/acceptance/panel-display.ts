/** Explicit native panel-display fixture. Never imported by the product or default tests. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { Cause } from "effect";
import {
	app,
	BrowserWindow,
	type NativeImage,
	nativeImage,
	type Rectangle,
	screen,
} from "electron";
import { canonicalHidSerial } from "../../../../../../packages/device/src/device-contracts.js";
import { QUAKE_VENDOR_ID } from "../../../../../../packages/protocol/src/contracts.js";
import { safeCause } from "../../diagnostics/privacy";
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
let owner: { close: () => Promise<void> } | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
// Print only the scrubbed cause: native messages can carry paths or serials.
async function fail(cause: unknown) {
	clearTimeout(deadline);
	console.error(
		"QUAKE panel E2E failed",
		JSON.stringify({ stage, cause: safeCause(Cause.die(cause)) }),
	);
	try {
		// Bounded so a hung native close cannot keep Electron alive.
		await Promise.race([owner?.close(), delay(5_000)]);
	} finally {
		app.exit(1);
	}
}
// Registered before any await so it runs ahead of the production ready handler.
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
desktop.catch(() => {});
const result = join(options.directory, "panel-result.json");

async function prepare() {
	stage = "ownership";
	owner = await ownNativeDevice(options.directory);
	// The production bus opens every attached QUAKE, so only the selected one may be present.
	stage = "exact device";
	const hid: typeof import("node-hid") = createRequire(import.meta.url)(
		"node-hid",
	);
	const serials = hid
		.devices()
		.filter((device) => device.vendorId === QUAKE_VENDOR_ID)
		.map((device) => canonicalHidSerial(device.serialNumber ?? ""));
	assert(
		serials.length > 0 && serials.every((serial) => serial === options.serial),
		"Attach only the selected QUAKE before running the panel fixture",
	);
	stage = "result";
	await writeFile(
		result,
		JSON.stringify({ id: "display", status: "incomplete" }),
		{ flag: "wx", mode: 0o600 },
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
	// The deadline releases the owner lock like any other failure.
	deadline = setTimeout(
		() => void fail(new Error(`Timed out at ${stage}`)),
		90_000,
	);
	stage = "production startup";
	await import("../../index");
}

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

async function run() {
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
	// Two matching captures of an error page are not a panel.
	const painted =
		typeof content === "object" &&
		content !== null &&
		"panel" in content &&
		content.panel === true;
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
			status: evidence.passed && painted ? "passed" : "failed",
			bounds: before.bounds,
			evidence,
			content,
			limits:
				"Captures the macOS framebuffer sent to the QUAKE; it does not observe backlight or physical light output.",
		}),
		{ mode: 0o600 },
	);
	assert(painted, "The panel window did not render the strip panel");
	assert(evidence.passed, `Panel display mismatch ${JSON.stringify(evidence)}`);
	console.info(
		"QUAKE panel E2E PASS: the QUAKE display shows the rendered production panel",
	);
}

// Electron stays unready until top-level awaits settle, which the composition
// root's privileged scheme registration requires.
const prepared = await prepare().then(
	() => true,
	async (cause: unknown) => {
		await fail(cause);
		return false;
	},
);
if (prepared)
	run().then(async () => {
		clearTimeout(deadline);
		await owner?.close();
		app.quit();
	}, fail);
