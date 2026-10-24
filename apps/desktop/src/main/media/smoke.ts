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
	SYNTHETIC_TOUCH_DOWN,
	SYNTHETIC_TOUCH_EMPTY,
	SYNTHETIC_TOUCH_MOVE,
} from "../../../../../packages/device/src/touch/touch-fixtures";
import { PROFILES_SNAPSHOT } from "../../shared/profile-snapshot-contracts";
import type { EncodedProfileEnvelope } from "../../shared/profiles";
import {
	type WallpaperCommand,
	WallpaperReply,
	type WallpaperSnapshot,
} from "../../shared/wallpaper-contracts";
import { registerHardware } from "../hardware";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { startMockDeviceBus } from "../mockDeviceBus";
import { ProfilesLive, registerProfiles } from "../profiles/profile-ipc";
import { makeDisplay } from "../test/display";
import {
	clockProfile,
	meetAiProfile,
	quickProfile,
	spansProfile,
	stripFixtureEnvelope,
	vividProfile,
} from "../test/strip-fixtures";
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

/** Serves one fixture envelope; re-registering swaps the active profile. */
function serveProfiles(
	envelope: EncodedProfileEnvelope,
): ReturnType<typeof registerProfiles> {
	return registerProfiles(
		ManagedRuntime.make(
			ProfilesLive({
				read: async () => structuredClone(envelope),
				write: async () => undefined,
			}),
		),
		pathToFileURL(resolve("out/renderer/index.html")).href,
	);
}

const settle = (ms = 400): Promise<void> =>
	new Promise<void>((done) => setTimeout(done, ms));

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
	const unregisterHardware = registerHardware(
		() => undefined,
		() => management,
		true,
	);
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
	let profiles = serveProfiles(stripFixtureEnvelope(quickProfile, "smoke-A"));
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
	// The panel draws the active page's key grid on black, not the wallpaper.
	await panel.webContents.reload();
	await settle();
	const strip: unknown = await panel.webContents.executeJavaScript(
		`(() => { const screen = document.querySelector('.strip-screen'); return { theme: document.querySelector('.strip-grid')?.dataset.theme, tiles: document.querySelectorAll('.strip-slot[data-state="tile"]').length, empty: document.querySelectorAll('.strip-slot[data-state="empty"]').length, wallpaper: !!document.querySelector('.strip-wallpaper'), background: getComputedStyle(screen).backgroundColor, width: screen.getBoundingClientRect().width }; })()`,
	);
	assert.deepEqual(strip, {
		theme: "commonBaseTheme",
		tiles: 12,
		empty: 4,
		wallpaper: false,
		background: "rgb(0, 0, 0)",
		width: 1920,
	});
	// The Screen page previews the vivid screen's wallpaper with the same strip.
	await management.webContents.executeJavaScript(
		`(() => { document.querySelector('.nav-item[title="Screen"]').click(); null; })()`,
	);
	await settle(100);
	await management.webContents.executeJavaScript(
		`(() => { document.querySelector('input[type="radio"][value="vivid"]').click(); null; })()`,
	);
	await settle(100);
	const canvas = await management.webContents.executeJavaScript(
		`(() => { const canvas = document.querySelector('.strip-wallpaper .wallpaper-canvas'); const image = canvas?.querySelector('image'); return { viewBox: canvas?.getAttribute('viewBox'), width: image?.getAttribute('width'), height: image?.getAttribute('height') }; })()`,
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
	if (artifacts) await mkdir(artifacts, { recursive: true });
	management.setSize(1100, 1000);
	// Exercise the production diagnostic preload/handler/controller with synthetic topology.
	await management.webContents.executeJavaScript(
		`document.querySelector('.nav-item[title="Connection"]').click(); null;`,
	);
	await new Promise((resolve) => setTimeout(resolve, 100));
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
	assert.equal(
		await management.webContents.executeJavaScript(
			"document.querySelector('[data-session]').getAttribute('data-session')",
		),
		"device",
	);
	assert.equal(
		await management.webContents.executeJavaScript(
			`document.querySelector('.nav-item[title="Screen"]').getAttribute('aria-current')`,
		),
		"page",
		"Passing the connection check must enter Screen automatically",
	);
	await management.webContents.executeJavaScript(
		`document.querySelector('.nav-item[title="Connection"]').click(); null;`,
	);
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert(
		(
			await management.webContents.executeJavaScript("document.body.innerText")
		).includes("both connections are normal"),
	);
	if (artifacts)
		await writeFile(
			join(artifacts, "diagnostic-ready.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
	// Readiness loss must return from Screen to diagnostics through the mounted subscriber.
	await management.webContents.executeJavaScript(
		`document.querySelector('.nav-item[title="Screen"]').click(); null;`,
	);
	await settle(100);
	management.webContents.send("quake:diagnostic", {
		...lifecycle.status(),
		checking: true,
	});
	await settle(100);
	assert.equal(
		await management.webContents.executeJavaScript(
			`document.querySelector('.nav-item[title="Connection"]').getAttribute('aria-current')`,
		),
		"page",
		"A pending pairing must return Screen to Connection",
	);
	const timedOut = {
		...lifecycle.status(),
		hdmi: "fail",
		checking: false,
		issue: "timeout",
	};
	management.webContents.send("quake:diagnostic", timedOut);
	await settle(100);
	assert.equal(
		await management.webContents.executeJavaScript(
			`document.querySelector('.nav-item[title="Connection"]').getAttribute('aria-current')`,
		),
		"page",
		"Pairing timeout must keep diagnostics visible",
	);
	if (artifacts)
		await writeFile(
			join(artifacts, "diagnostic-pairing-timeout.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
	await management.webContents.executeJavaScript(
		`document.querySelector('.nav-item[title="Screen"]').click(); null;`,
	);
	await settle(100);
	management.webContents.send("quake:diagnostic", timedOut);
	await settle(100);
	assert.equal(
		await management.webContents.executeJavaScript(
			`document.querySelector('.nav-item[title="Screen"]').getAttribute('aria-current')`,
		),
		"page",
		"Deliberate offline Screen preview must remain available on repeated failed status",
	);
	await lifecycleRuntime.runPromise(lifecycle.topology());
	await settle(100);
	management.webContents.send("quake:diagnostic", {
		...lifecycle.status(),
		issue: "native-failed",
	});
	await settle(100);
	assert.equal(
		await management.webContents.executeJavaScript(
			`document.querySelector('.nav-item[title="Connection"]').getAttribute('aria-current')`,
		),
		"page",
		"Readiness loss while on Screen must return to Connection",
	);
	assert(
		(
			await management.webContents.executeJavaScript("document.body.innerText")
		).includes("Quake display arrangement failed"),
	);
	assert(
		(
			await management.webContents.executeJavaScript("document.body.innerText")
		).includes("10 minutes"),
	);
	if (artifacts)
		await writeFile(
			join(artifacts, "diagnostic-layout-failed.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
	await lifecycleRuntime.runPromise(lifecycle.topology());
	// Built-in-like profiles on the panel, swapped through the read-only channel.
	const fixtures = [
		["quick", quickProfile, "commonBaseTheme"],
		["meetai", meetAiProfile, "meetingAssistantTheme"],
		["spans", spansProfile, "commonBaseTheme"],
		["clock", clockProfile, "commonBaseTheme"],
		["vivid", vividProfile, undefined],
	] as const;
	for (const [name, profile, theme] of fixtures) {
		await profiles.dispose();
		profiles = serveProfiles(stripFixtureEnvelope(profile, "smoke-A"));
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await settle();
		const shown: unknown = await panel.webContents.executeJavaScript(
			`(() => ({ theme: document.querySelector('.strip-grid')?.dataset.theme, vivid: document.querySelector('.strip-screen')?.dataset.vivid, clock: !!document.querySelector('.strip-clock-placeholder') }))()`,
		);
		assert.deepEqual(shown, {
			theme,
			vivid: theme === undefined ? "true" : "false",
			clock: name === "clock",
		});
		if (artifacts)
			await writeFile(
				join(artifacts, `panel-${name}.png`),
				(await panel.webContents.capturePage()).toPNG(),
			);
	}
	await profiles.dispose();
	profiles = serveProfiles(stripFixtureEnvelope(quickProfile, "smoke-A"));
	await panel.loadFile(resolve("out/renderer/index.html"), {
		query: { surface: "panel" },
	});
	await management.webContents.reload();
	await settle();
	if (artifacts) {
		management.setSize(1100, 900);
		await settle(200);
		await writeFile(
			join(artifacts, "management-overview.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
	}
	await management.webContents.executeJavaScript(
		`(() => { document.querySelector('.nav-item[title="Appearance"]').click(); null; })()`,
	);
	await new Promise<void>((done) => setTimeout(done, 100));
	await management.webContents.executeJavaScript(
		`(() => { document.querySelector('input[type="radio"][value="light"]').click(); document.querySelector('input[type="radio"][value="reduce"]').click(); document.querySelector('.nav-item[title="Overview"]').click(); null; })()`,
	);
	await new Promise<void>((done) => setTimeout(done, 100));
	for (const window of [management, panel]) {
		const appearance: unknown = await window.webContents.executeJavaScript(
			`(() => { const strip = document.querySelector('.strip-screen'); return { token: getComputedStyle(document.documentElement).getPropertyValue('--quake-background').trim(), strip: getComputedStyle(strip).backgroundColor, animations: document.getAnimations().length }; })()`,
		);
		// The light theme reaches both windows; the strip keeps DK's black.
		assert.deepEqual(appearance, {
			token: "#f4f4f6",
			strip: "rgb(0, 0, 0)",
			animations: 0,
		});
	}
	if (artifacts) {
		await writeFile(
			join(artifacts, "panel.png"),
			(await panel.webContents.capturePage()).toPNG(),
		);
		management.setSize(1100, 1000);
		await management.webContents.executeJavaScript(
			`(() => { document.querySelector('.nav-item[title="Screen"]').click(); null; })()`,
		);
		await new Promise<void>((done) => setTimeout(done, 100));
		await writeFile(
			join(artifacts, "management.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
		management.setSize(390, 844);
		await new Promise<void>((done) => setTimeout(done, 100));
		await management.webContents.executeJavaScript(
			`(() => { document.querySelector('.nav-item[title="Screen"]').click(); null; })()`,
		);
		await new Promise<void>((done) => setTimeout(done, 100));
		const overflow: unknown = await management.webContents.executeJavaScript(
			"document.documentElement.scrollWidth > innerWidth",
		);
		assert.equal(overflow, false, "Narrow management layout must not overflow");
		await writeFile(
			join(artifacts, "management-narrow.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
	}
	// Exercise the mounted panel adapter via the real preload/event IPC.
	await panel.webContents.executeJavaScript(`(() => {
		window.__stripKeys = [];
		const root = document.getElementById('root');
		root.addEventListener('quake-strip-key', e => window.__stripKeys.push(e.detail));
	})()`);
	const mockTouch = startMockDeviceBus();
	const offTouch = mockTouch.on((event) => {
		if (event.kind === "touch") panel.webContents.send("quake:event", event);
	});
	mockTouch.emitTouchReport(SYNTHETIC_TOUCH_DOWN);
	await settle(30);
	assert.equal(
		await panel.webContents.executeJavaScript(
			`document.querySelector('[data-state="tile"][data-key-code="1,1"]').dataset.pressed`,
		),
		"true",
		"Touch presses the tile returned by strip geometry",
	);
	mockTouch.emitTouchReport(SYNTHETIC_TOUCH_MOVE);
	mockTouch.emitTouchReport(SYNTHETIC_TOUCH_EMPTY);
	await new Promise<void>((done) => setTimeout(done, 60));
	const keys: unknown =
		await panel.webContents.executeJavaScript("window.__stripKeys");
	assert.deepEqual(keys, [
		{ keyCode: "1,1", keyAction: 0 },
		{ keyCode: "1,1", keyAction: 1, voiceTouchEnd: true },
	]);
	process.stdout.write(
		"Strip touch smoke PASS: raw synthetic frames -> parser/tracker -> main bus -> preload IPC -> mounted panel -> down/up, no hardware.\n",
	);
	const touchAt = (x: number, y: number): Uint8Array => {
		const rawY = 480 - y;
		return new Uint8Array([
			0xa3,
			0,
			0,
			0x1a,
			1,
			1,
			rawY & 0xff,
			rawY >> 8,
			x & 0xff,
			x >> 8,
		]);
	};
	mockTouch.emitTouchReport(touchAt(240, 120)); // Gap between 1,1 and 1,2.
	mockTouch.emitTouchReport(SYNTHETIC_TOUCH_EMPTY);
	await settle(30);
	assert.deepEqual(
		await panel.webContents.executeJavaScript("window.__stripKeys"),
		keys,
		"Grid gaps never emit ordinary key events",
	);
	// Swap the committed profile through the production preload subscription.
	// Its inward-growing span must replace the previous ordinary key hit.
	panel.webContents.send(PROFILES_SNAPSHOT, {
		_tag: "ready",
		envelope: stripFixtureEnvelope(spansProfile, "smoke-A"),
	});
	await settle(30);
	mockTouch.emitTouchReport(SYNTHETIC_TOUCH_DOWN);
	mockTouch.emitTouchReport(SYNTHETIC_TOUCH_EMPTY);
	await settle(30);
	assert.deepEqual(
		await panel.webContents.executeJavaScript("window.__stripKeys.slice(-2)"),
		[
			{ keyCode: "2,1", keyAction: 0 },
			{ keyCode: "2,1", keyAction: 1, voiceTouchEnd: true },
		],
	);
	// Establish a registry with a scroller, then add a clickable child over it.
	await panel.webContents.executeJavaScript(`(() => {
		window.__subTouch = [];
		const tile = document.querySelector('[data-state="tile"][data-key-code="2,8"]');
		const scroll = document.createElement('div');
		scroll.dataset.quakeSubTouch = 'scroll'; scroll.dataset.supportQuakeMove = 'true';
		scroll.style.cssText = 'position:absolute;inset:0'; tile.appendChild(scroll);
		for (const phase of ['start', 'end']) scroll.addEventListener('quake-sub-touch-' + phase, e => window.__subTouch.push(e.detail));
	})()`);
	mockTouch.emitTouchReport(touchAt(1800, 360));
	mockTouch.emitTouchReport(SYNTHETIC_TOUCH_EMPTY);
	await settle(30);
	assert.equal(
		await panel.webContents.executeJavaScript(
			"window.__subTouch.at(-1)?.subElementId",
		),
		"scroll",
	);
	await panel.webContents.executeJavaScript(`(() => {
		const scroll = document.querySelector('[data-quake-sub-touch="scroll"]');
		const button = document.createElement('button'); button.dataset.quakeSubTouch = 'new-button';
		button.style.cssText = 'position:absolute;inset:0'; scroll.appendChild(button);
		for (const phase of ['start', 'end']) button.addEventListener('quake-sub-touch-' + phase, e => window.__subTouch.push(e.detail));
	})()`);
	await settle(30); // Deliver the real MutationObserver callback.
	mockTouch.emitTouchReport(touchAt(1800, 360));
	mockTouch.emitTouchReport(SYNTHETIC_TOUCH_EMPTY);
	await settle(30);
	assert.deepEqual(
		await panel.webContents.executeJavaScript(
			`window.__subTouch.map(({subElementId, phase, confirmedTap}) => ({subElementId, phase, confirmedTap}))`,
		),
		[
			{ subElementId: "scroll", phase: "start", confirmedTap: false },
			{ subElementId: "scroll", phase: "end", confirmedTap: false },
			{ subElementId: "new-button", phase: "start", confirmedTap: false },
			{ subElementId: "new-button", phase: "end", confirmedTap: true },
		],
	);
	offTouch();
	mockTouch.stop();
	if (artifacts)
		await writeFile(
			join(artifacts, "panel-touch-complete.png"),
			(await panel.webContents.capturePage()).toPNG(),
		);
	process.stdout.write(
		"Strip integration smoke PASS: real grid hits, press feedback, gaps and dynamic clickable discovery inside an existing scroller.\n",
	);
	unregisterHardware();
	removeLifecycle();
	await lifecycleRuntime.dispose();
	await profiles.dispose();
	management.destroy();
	panel.destroy();
	process.stdout.write(
		"W6 Electron smoke PASS: spoofed panel mutations rejected, native PNG/JPEG decoding, isolated serials, real preload/IPC, three fill modes, synchronized one-second clock, light theme/reduced motion, hidden panel/preview, strip key grid for five built-in-like profiles. Hardware unverified.\n",
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
