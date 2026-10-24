/** Run with Electron, not Node. Both app windows stay hidden. See README.md. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import type { Display } from "electron";
import { app, BrowserWindow, dialog, nativeImage } from "electron";
import {
	type WallpaperCommand,
	WallpaperReply,
	type WallpaperSnapshot,
} from "../../shared/wallpaper-contracts";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { makeDisplay } from "../test/display";
import { MediaLive, registerMedia } from "./index";

const directory = mkdtempSync(join(tmpdir(), "open-quake-w6-smoke-"));
app.setPath("userData", directory);
const pngPath = join(directory, "checkerboard.png");
const jpegPath = join(directory, "second.jpg");
let selectedPath = pngPath;
dialog.showOpenDialog = async () => ({
	canceled: false,
	filePaths: [selectedPath],
});

async function request(
	window: BrowserWindow,
	command: WallpaperCommand,
): Promise<WallpaperSnapshot> {
	const reply: unknown = await window.webContents.executeJavaScript(
		`window.quakeWallpaper.request(${JSON.stringify(command)})`,
	);
	assert(Schema.is(WallpaperReply)(reply));
	assert.equal(reply._tag, "success", JSON.stringify(reply));
	if (reply._tag !== "success") throw new Error("Wallpaper request failed");
	return reply.snapshot;
}

async function smoke(): Promise<void> {
	await app.whenReady();
	const pixels = Buffer.alloc(480 * 480 * 4);
	for (let y = 0; y < 480; y++)
		for (let x = 0; x < 480; x++) {
			const offset = (y * 480 + x) * 4;
			const shade = (Math.floor(x / 60) + Math.floor(y / 60)) % 2 ? 210 : 40;
			pixels[offset] = shade;
			pixels[offset + 1] = shade;
			pixels[offset + 2] = shade;
			pixels[offset + 3] = 255;
		}
	const image = nativeImage.createFromBitmap(pixels, {
		width: 480,
		height: 480,
	});
	assert(!image.isEmpty());
	await writeFile(pngPath, image.toPNG());
	await writeFile(jpegPath, image.toJPEG(90));
	const options = {
		show: false,
		useContentSize: true,
		width: 1920,
		height: 480,
		webPreferences: {
			preload: resolve("out/preload/index.mjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	};
	const management = new BrowserWindow(options);
	const panel = new BrowserWindow(options);
	let runtimeDisposed = false;
	const runtime = ManagedRuntime.make(
		Layer.merge(
			MediaLive(join(directory, "wallpaper-v1")),
			Layer.scopedDiscard(
				Effect.addFinalizer(() =>
					Effect.sync(() => {
						runtimeDisposed = true;
					}),
				),
			),
		),
	);
	registerMedia(runtime, () => management);
	let mockDisplays: readonly Display[] = [];
	const lifecycleRuntime = ManagedRuntime.make(
		DeviceLifecycle.Default({
			mock: true,
			development: true,
			displays: () => mockDisplays,
			watch: () => () => {},
			panel: () => {},
			bus: () => ({
				on: () => () => {},
				currentStatus: () => undefined,
				recover: () => Effect.sleep(100),
			}),
			notify: (status) =>
				management.webContents.send("quake:diagnostic", status),
			prompts: {
				platform: process.platform,
				mock: true,
				displays: () => mockDisplays,
				primaryId: () => 1,
				prompt: () => Effect.die("Smoke must never prompt"),
				native: () => Effect.die("Smoke must never call native display APIs"),
				openSettings: () => Effect.void,
			},
		}),
	);
	const lifecycle = await lifecycleRuntime.runPromise(DeviceLifecycle);
	const removeLifecycle = registerLifecycle(
		lifecycleRuntime,
		() => management,
		pathToFileURL(resolve("out/renderer/index.html")).href,
	);
	app.once("will-quit", () => {
		assert(
			runtimeDisposed,
			"Media runtime must be disposed before Electron quits",
		);
		process.stdout.write("Media runtime disposal before will-quit PASS\n");
	});
	await Promise.all([
		management.loadFile(resolve("out/renderer/index.html")),
		panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		}),
	]);
	// A panel spoofing the management query still has only read permission.
	await panel.loadFile(resolve("out/renderer/index.html"), {
		query: { surface: "management" },
	});
	for (const tag of ["select", "import", "configure", "clear", "restore"]) {
		const reply: unknown = await panel.webContents.executeJavaScript(
			`window.quakeWallpaper.request(${JSON.stringify({ _tag: tag, serial: "spoofed", revision: 0, fillMode: "contain", hourFormat: "12h" })})`,
		);
		assert(Schema.is(WallpaperReply)(reply));
		assert.equal(
			reply._tag,
			"failure",
			"Spoofed panel mutation must be rejected",
		);
	}
	await panel.loadFile(resolve("out/renderer/index.html"), {
		query: { surface: "panel" },
	});
	await request(management, { _tag: "select", serial: "smoke-A" });
	const png = await request(management, {
		_tag: "import",
		serial: "smoke-A",
		revision: 0,
	});
	assert.equal(png.asset._tag, "ready");
	assert.equal(png.saved.settings.displayMediaList[0]?.format, "image/png");
	assert.equal(png.deviceDelivery, "unverified");
	for (const fillMode of ["contain", "cover", "center"] as const) {
		const next = await request(management, {
			_tag: "configure",
			serial: "smoke-A",
			revision: (await request(management, { _tag: "read" })).saved.revision,
			fillMode,
			hourFormat: "12h",
		});
		const other = await request(panel, { _tag: "read" });
		assert.deepEqual(next.saved, other.saved);
		assert.deepEqual(next.asset, other.asset);
	}
	selectedPath = jpegPath;
	const jpg = await request(management, {
		_tag: "import",
		serial: "smoke-A",
		revision: (await request(management, { _tag: "read" })).saved.revision,
	});
	assert.equal(jpg.saved.settings.displayMediaList[0]?.format, "image/jpeg");
	const b = await request(management, { _tag: "select", serial: "smoke-B" });
	assert.equal(b.asset._tag, "empty");
	const a = await request(management, { _tag: "select", serial: "smoke-A" });
	assert.equal(a.asset._tag, "ready");
	for (const window of [management, panel])
		await window.webContents.executeJavaScript(
			`window.__wallpaperTicks = []; window.quakeWallpaper.onClock(value => window.__wallpaperTicks.push(value)); null;`,
		);
	await new Promise<void>((done) => setTimeout(done, 2100));
	const ticks: unknown = await management.webContents.executeJavaScript(
		"window.__wallpaperTicks",
	);
	const panelTicks: unknown = await panel.webContents.executeJavaScript(
		"window.__wallpaperTicks",
	);
	assert(Array.isArray(ticks) && ticks.length >= 2);
	assert.deepEqual(ticks, panelTicks);
	const canvas = await management.webContents.executeJavaScript(
		`(() => { const canvas = document.querySelector('.wallpaper-canvas'); const image = canvas?.querySelector('image'); return { viewBox: canvas?.getAttribute('viewBox'), width: image?.getAttribute('width'), height: image?.getAttribute('height') }; })()`,
	);
	assert.deepEqual(canvas, {
		viewBox: "0 0 1920 480",
		width: "480",
		height: "480",
	});
	const errors: unknown = await management.webContents.executeJavaScript(
		"document.body.innerText",
	);
	assert(
		typeof errors === "string" && !errors.includes("service is unavailable"),
	);
	const artifacts = process.argv[2];
	management.setSize(1100, 1000);
	// Exercise the production diagnostic preload/handler/controller with synthetic topology.
	await management.webContents.executeJavaScript(
		"document.querySelector('.connection-check').scrollIntoView(); null;",
	);
	await new Promise<void>((done) => setTimeout(done, 100));
	assert(
		(
			await management.webContents.executeJavaScript("document.body.innerText")
		).includes("No USB device detected"),
	);
	if (artifacts) {
		await mkdir(artifacts, { recursive: true });
		await writeFile(
			join(artifacts, "diagnostic-disconnected.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
	}
	await management.webContents.executeJavaScript(
		"document.querySelector('.connection-actions button').click(); null;",
	);
	await new Promise<void>((done) => setTimeout(done, 30));
	assert.equal(
		await management.webContents.executeJavaScript(
			"document.querySelector('.connection-actions button').disabled",
		),
		true,
	);
	await new Promise<void>((done) => setTimeout(done, 150));
	assert.equal(
		await management.webContents.executeJavaScript(
			"document.querySelector('.connection-actions button').disabled",
		),
		false,
	);
	const rejected: unknown = await panel.webContents.executeJavaScript(
		"window.quakeLifecycle.request({action:'redetect'})",
	);
	assert.deepEqual(rejected, {
		ok: false,
		code: "DESKTOP.LIFECYCLE.FORBIDDEN",
	});
	mockDisplays = [
		makeDisplay({
			id: 2,
			label: "DK-QUAKE",
			size: { width: 1024, height: 768 },
		}),
	];
	await lifecycleRuntime.runPromise(
		lifecycle.onStatus({ source: "mock", kind: "status", state: "connected" }),
	);
	await new Promise<void>((done) => setTimeout(done, 100));
	assert(
		(
			await management.webContents.executeJavaScript("document.body.innerText")
		).includes("current 1024x768"),
	);
	if (artifacts)
		await writeFile(
			join(artifacts, "diagnostic-resolution.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
	if (artifacts) {
		management.setSize(390, 844);
		await management.webContents.executeJavaScript(
			"document.querySelector('.connection-check').scrollIntoView(); null;",
		);
		await new Promise<void>((done) => setTimeout(done, 100));
		assert.equal(
			await management.webContents.executeJavaScript(
				"document.documentElement.scrollWidth > innerWidth",
			),
			false,
		);
		await writeFile(
			join(artifacts, "diagnostic-narrow.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
		management.setSize(1100, 1000);
	}
	mockDisplays = [
		makeDisplay({
			id: 2,
			label: "DK-QUAKE",
			size: { width: 1920, height: 480 },
		}),
	];
	await lifecycleRuntime.runPromise(lifecycle.topology());
	await new Promise<void>((done) => setTimeout(done, 100));
	assert(
		(
			await management.webContents.executeJavaScript("document.body.innerText")
		).includes("both connections are normal"),
	);
	assert.equal(
		await management.webContents.executeJavaScript(
			"document.querySelector('[data-session]').getAttribute('data-session')",
		),
		"device",
	);
	if (artifacts)
		await writeFile(
			join(artifacts, "diagnostic-ready.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
	await management.webContents.executeJavaScript(
		`(() => { const selects = document.querySelectorAll('.appearance select'); const theme = selects[0]; const motion = selects[1]; theme.value = 'light'; theme.dispatchEvent(new Event('change', { bubbles: true })); motion.value = 'reduce'; motion.dispatchEvent(new Event('change', { bubbles: true })); })()`,
	);
	await new Promise<void>((done) => setTimeout(done, 100));
	for (const window of [management, panel]) {
		const appearance: unknown = await window.webContents.executeJavaScript(
			`(() => { const background = document.querySelector('.wallpaper-neutral'); return { fill: getComputedStyle(background).fill, animations: document.querySelector('.wallpaper-canvas').getAnimations({ subtree: true }).length }; })()`,
		);
		assert.deepEqual(appearance, { fill: "rgb(245, 247, 250)", animations: 0 });
	}
	if (artifacts) {
		await mkdir(artifacts, { recursive: true });
		await writeFile(
			join(artifacts, "panel.png"),
			(await panel.webContents.capturePage()).toPNG(),
		);
		management.setSize(1100, 1000);
		await management.webContents.executeJavaScript(
			"document.querySelector('.wallpaper-settings').scrollIntoView(); null;",
		);
		await writeFile(
			join(artifacts, "management.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
		management.setSize(390, 844);
		await new Promise<void>((done) => setTimeout(done, 100));
		await management.webContents.executeJavaScript(
			"document.querySelector('.wallpaper-settings').scrollIntoView(); null;",
		);
		const overflow: unknown = await management.webContents.executeJavaScript(
			"document.documentElement.scrollWidth > innerWidth",
		);
		assert.equal(overflow, false, "Narrow management layout must not overflow");
		await writeFile(
			join(artifacts, "management-narrow.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
	}
	removeLifecycle();
	await lifecycleRuntime.dispose();
	management.destroy();
	panel.destroy();
	process.stdout.write(
		"W6 Electron smoke PASS: spoofed panel mutations rejected, native PNG/JPEG decoding, isolated serials, real preload/IPC, three fill modes, synchronized one-second clock, light theme/reduced motion, hidden panel/preview. Hardware unverified.\n",
	);
}

smoke()
	.then(async () => {
		await rm(directory, { recursive: true, force: true });
		app.quit();
	})
	.catch(async (cause: unknown) => {
		process.stderr.write(
			`${cause instanceof Error ? cause.stack : String(cause)}\n`,
		);
		await rm(directory, { recursive: true, force: true });
		app.exit(1);
	});
