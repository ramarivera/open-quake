/** Run with Electron, not Node. Both app windows stay hidden. See README.md. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import type { Display } from "electron";
import { app, BrowserWindow, dialog, ipcMain, nativeImage } from "electron";
import { KeyRuntime } from "../../../../../packages/device/src/actions/key-runtime-service.js";
import { KeyEditing } from "../../../../../packages/device/src/profiles/key-editing-service.js";
import {
	createEmptyProfileKey,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import {
	SYNTHETIC_TOUCH_DOWN,
	SYNTHETIC_TOUCH_EMPTY,
	SYNTHETIC_TOUCH_MOVE,
} from "../../../../../packages/device/src/touch/touch-fixtures";
import { fakeObsServer } from "../../../../../packages/edge/src/obs/fake-server.test-support";
import { emptyObsSaved } from "../../../../../packages/edge/src/obs/obs-contracts";
import { openObsConnection } from "../../../../../packages/edge/src/obs/obs-transport";
import { AGENTS_REQUEST, type AgentReply } from "../../shared/agents";
import { KEY_RUNTIME } from "../../shared/key-library";
import { PROFILES_SNAPSHOT } from "../../shared/profile-snapshot-contracts";
import type { EncodedProfileEnvelope, Profile } from "../../shared/profiles";
import {
	type WallpaperCommand,
	WallpaperReply,
	type WallpaperSnapshot,
} from "../../shared/wallpaper-contracts";
import { ClockLive, registerClock, registerClockScheme } from "../clock";
import { registerDeviceReady } from "../device-ready";
import { registerHardware } from "../hardware";
import { registerKeyLibrary } from "../key-library/registration";
import { desktopKeyRuntimePort } from "../key-library/runtime-port";
import { registerKnob } from "../knob";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { registerMaintenance } from "../maintenance";
import { registerManagementAppearance } from "../management/appearance";
import { registerMeetings } from "../meetings";
import { startMockDeviceBus } from "../mockDeviceBus";
import { registerMonitor } from "../monitor";
import { prepareObs } from "../obs";
import { visibleObsKeys } from "../obs/visibility";
import { registerProfiles } from "../profiles/profile-ipc";
import { registerAppLocale } from "../settings/registration";
import { makeDisplay } from "../test/display";
import {
	clockProfile,
	meetAiProfile,
	quickProfile,
	spansProfile,
	stripFixtureEnvelope,
	vividProfile,
} from "../test/strip-fixtures";
import { createToneRecorder, registerVoiceSurface } from "../voice";
import { waitForVoice } from "../voice/smoke-wait";
import { WeatherMediaController } from "../weather-media/controller";
import { registerWeatherMedia } from "../weather-media/index";
import { weatherSettingsLive } from "../weather-media/settings-repository";
import { SystemMediaAdapter } from "../weather-media/system-media";
import { mediaSession } from "../weather-media/test-fixtures";
import { WeatherNetwork } from "../weather-media/weather-network";
import { MediaLive, registerMedia } from "./index";

assert.equal(
	process.env.OPEN_QUAKE_MOCK_DEVICE,
	"1",
	"Native smoke requires mock device mode",
);
const directory = mkdtempSync(join(tmpdir(), "open-quake-w6-smoke-"));
app.setPath("userData", directory);
if (process.platform === "darwin") app.setActivationPolicy("prohibited");
// The clock tile reads its own store, as in the app.
registerClockScheme();
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

let managementWindow: BrowserWindow | undefined;
/** Serves one committed fixture to both snapshot and key-runtime consumers. */
function serveProfiles(envelope: EncodedProfileEnvelope): {
	dispose: () => Promise<void>;
	read: () => Promise<ProfileEnvelope>;
} {
	const renderer = pathToFileURL(resolve("out/renderer/index.html")).href;
	const profiles = ProfileService.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(
			ProfileRepository.Default.pipe(
				Layer.provide(
					profileStorageLayer({
						read: async () => structuredClone(envelope),
						write: async () => undefined,
					}),
				),
			),
		),
	);
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			KeyEditing.DefaultWithoutDependencies,
			KeyRuntime.DefaultWithoutDependencies.pipe(
				Layer.provide(
					desktopKeyRuntimePort(
						() => undefined,
						(state) => {
							for (const win of BrowserWindow.getAllWindows())
								win.webContents.send(KEY_RUNTIME, state);
						},
					),
				),
			),
		).pipe(Layer.provideMerge(profiles)),
	);
	const snapshots = registerProfiles(runtime, renderer, false);
	const keys = registerKeyLibrary(runtime, () => managementWindow, renderer);
	return {
		read: () =>
			runtime.runPromise(
				ProfileService.loadProfiles().pipe(
					Effect.map(({ envelope }) => envelope),
				),
			),
		dispose: async () => {
			await keys.dispose();
			await snapshots.dispose();
			await runtime.dispose();
		},
	};
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
	managementWindow = management;
	const panel = new BrowserWindow(options);
	// Media-only fixture has no device session. Register the production offline reader.
	const removeDeviceReady = registerDeviceReady({
		bus: () => undefined,
		rotation: () => undefined,
		mock: true,
		panelSerial: (sender) =>
			sender === panel.webContents ? "smoke-A" : undefined,
		management: () => management.webContents,
	});
	const locale = registerAppLocale({
		directory,
		osLocale: "en-US",
		renderer: pathToFileURL(resolve("out/renderer/index.html")).href,
		windows: () => [management, panel],
	});
	management.webContents.setAudioMuted(true);
	panel.webContents.setAudioMuted(true);
	// This media-only fixture has no agent service; the management smoke owns it.
	ipcMain.handle(
		AGENTS_REQUEST,
		(): AgentReply => ({
			_tag: "rejected",
			code: "AGENT.IPC.UNAVAILABLE",
			message: "Agent service is outside the media smoke fixture",
		}),
	);
	const removeAppearance = registerManagementAppearance(
		() => management,
		directory,
		pathToFileURL(resolve("out/renderer/index.html")).href,
	);

	let weatherRequests = 0;
	const weatherMedia = registerWeatherMedia(
		ManagedRuntime.make(
			WeatherMediaController.Default.pipe(
				Layer.provide(
					Layer.mergeAll(
						weatherSettingsLive(directory),
						Layer.succeed(SystemMediaAdapter, {
							read: () =>
								Effect.succeed({
									session: mediaSession,
									sessions: [mediaSession],
									error: null,
								}),
							control: () => Effect.succeed(false),
						}),
						Layer.succeed(WeatherNetwork, {
							json: () =>
								Effect.sync(() => {
									weatherRequests++;
									return {};
								}),
						}),
					),
				),
			),
		),
		() => management,
	);
	const voice = registerVoiceSurface({
		mock: true,
		tones: createToneRecorder(),
		serial: () => "smoke-A",
		panel: () => panel,
		management: () => management,
		renderer: pathToFileURL(resolve("out/renderer/index.html")).href,
	});
	const knob = registerKnob(
		() => panel,
		() => [management, panel],
		{
			readVolume: Effect.succeed({ level: 50, muted: false }),
			writeVolume: () => Effect.void,
		},
	);
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
	const clock = registerClock(
		ManagedRuntime.make(ClockLive(directory)),
		() => management,
	);
	const monitor = registerMonitor(
		directory,
		() => management,
		() => panel,
		{
			collect: () => Effect.die("Unmounted monitor must not collect host data"),
		},
	);
	const maintenance = registerMaintenance({
		root: directory,
		mock: true,
		renderer: pathToFileURL(resolve("out/renderer/index.html")).href,
		hardware: () => undefined,
		management: () => management,
		stopWriters: async () =>
			assert.fail("Read-only smoke must not reset or restore"),
		exit: () => assert.fail("Read-only maintenance must not exit the app"),
	});
	await maintenance.ready;
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
	const meetings = registerMeetings({
		userData: directory,
		hardware: () => undefined,
		mock: true,
		renderer: pathToFileURL(resolve("out/renderer/index.html")).href,
	});
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
	const actionLabels: unknown = await management.webContents.executeJavaScript(
		`[...document.querySelectorAll('.button-row button')].map(button => button.textContent)`,
	);
	assert(
		Array.isArray(actionLabels) &&
			actionLabels.includes("Add Media…") &&
			actionLabels.includes("Remove All"),
	);
	// Cluster 18: exercise the mounted playlist editor without foreground input.
	selectedPath = pngPath;
	await request(management, {
		_tag: "import",
		serial: "smoke-A",
		revision: (await request(management, { _tag: "read" })).saved.revision,
		append: true,
	});
	await settle(150);
	await management.webContents.executeJavaScript(
		`document.querySelector('button[aria-label="Move checkerboard.png up"]').click(); null;`,
	);
	await settle(150);
	assert.equal(
		(await request(management, { _tag: "read" })).saved.settings
			.displayMediaList[0]?.name,
		"checkerboard.png",
	);
	await management.webContents.executeJavaScript(`(() => {
 const rows = document.querySelectorAll('.wallpaper-playlist li'); const dataTransfer = new DataTransfer();
 rows[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
 rows[1].dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }));
 rows[1].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
 return null;
 })()`);
	await settle(150);
	assert.equal(
		(await request(management, { _tag: "read" })).saved.settings
			.displayMediaList[0]?.name,
		"second.jpg",
	);
	const beforeNoop = await request(management, { _tag: "read" });
	await management.webContents.executeJavaScript(`(() => {
 const row = document.querySelector('.wallpaper-playlist li'); const dataTransfer = new DataTransfer();
 row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
 row.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer })); return null;
 })()`);
	await settle(150);
	assert.equal(
		(await request(management, { _tag: "read" })).saved.revision,
		beforeNoop.saved.revision,
	);
	for (const enabled of [true, false]) {
		await management.webContents.executeJavaScript(
			`(() => { const row = [...document.querySelectorAll('.row')].find(row => row.textContent.includes('Video Sound')); row.querySelector('input[value="${enabled ? "on" : "off"}"]').click(); return null; })()`,
		);
		await settle(150);
		assert.equal(
			(await request(management, { _tag: "read" })).saved.settings.enableSound,
			enabled,
		);
	}
	assert.equal(management.webContents.isAudioMuted(), true);
	assert.equal(panel.webContents.isAudioMuted(), true);
	process.stdout.write(
		"Cluster 18 renderer PASS: move buttons, drag reorder, persisted order, sound on/off, muted windows.\n",
	);

	const errors: unknown = await management.webContents.executeJavaScript(
		"document.body.innerText",
	);
	assert(
		typeof errors === "string" && !errors.includes("service is unavailable"),
	);
	const artifacts = process.argv[2];
	if (artifacts) await mkdir(artifacts, { recursive: true });
	management.setSize(1100, 1000);
	await settle(150);
	if (artifacts)
		await writeFile(
			join(artifacts, "wallpaper-playlist.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
	await management.webContents.executeJavaScript(
		"window.quakeLocale.set('de')",
	);
	await settle(150);
	const germanLabels: unknown = await management.webContents.executeJavaScript(
		`[...document.querySelectorAll('.button-row button')].map(button => button.textContent)`,
	);
	assert(
		Array.isArray(germanLabels) &&
			germanLabels.includes("Medien hinzufügen…") &&
			germanLabels.includes("Alle entfernen"),
	);
	if (artifacts)
		await writeFile(
			join(artifacts, "wallpaper-playlist-de.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
	await management.webContents.executeJavaScript(
		"window.quakeLocale.set('en')",
	);
	await settle(150);
	if (artifacts) {
		management.setSize(390, 844);
		await management.webContents.executeJavaScript(
			"document.querySelector('.wallpaper-playlist').scrollIntoView(); null;",
		);
		await settle(150);
		assert.equal(
			await management.webContents.executeJavaScript(
				"document.documentElement.scrollWidth > innerWidth",
			),
			false,
		);
		await writeFile(
			join(artifacts, "wallpaper-playlist-narrow.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
		management.setSize(1100, 1000);
	}

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
	const obsServer = await fakeObsServer({
		scenes: [
			{ sceneUuid: "scene-1", sceneName: "Main" },
			{ sceneUuid: "scene-2", sceneName: "Second scene" },
		],
		sceneItems: {
			"scene-1": [{ sceneItemId: 7, sourceName: "Camera" }],
			"scene-2": [{ sceneItemId: 42, sourceName: "Second camera" }],
		},
		silentInputs: ["image-1"],
		inputs: [
			{
				inputUuid: "media-1",
				inputName: "Media clips",
				inputKind: "ffmpeg_source",
			},
			{
				inputUuid: "vlc-1",
				inputName: "VLC playlist",
				inputKind: "vlc_source",
			},
			{
				inputUuid: "capture-1",
				inputName: "Windows microphone",
				inputKind: "wasapi_input_capture",
			},
			{
				inputUuid: "plugin-1",
				inputName: "Plugin audio",
				inputKind: "custom_source",
			},
			{
				inputUuid: "image-1",
				inputName: "Still image",
				inputKind: "image_source",
			},
		],
	});
	const jpeg = nativeImage
		.createFromBitmap(Buffer.alloc(128 * 128 * 4, 180), {
			width: 128,
			height: 128,
		})
		.toJPEG(50)
		.toString("base64");
	let obsSaved: unknown = {
		...emptyObsSaved,
		port: obsServer.port,
		manualOverride: true,
	};
	// The fake server supplies a valid jpeg for the real Chromium decoder.
	const obsRegistration = prepareObs({
		renderer: pathToFileURL(resolve("out/renderer/index.html")).href,
		management: () => management,
		panel: () => panel,
		visibleKeys: async () => visibleObsKeys(await profiles.read(), "smoke-A"),
		mock: true,
		storage: {
			store: {
				read: async () => obsSaved,
				write: async (value) => {
					obsSaved = value;
				},
			},
			vault: {
				put: async () => "fixture-reference",
				get: async () => "",
				remove: async () => {},
			},
			detect: async () => undefined,
		},
		open: openObsConnection,
	}).standalone();
	obsServer.screenshot(`data:image/jpeg;base64,${jpeg}`);
	const obsKey = (type: string, code: string, settings: unknown) => {
		const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey(code));
		return {
			...empty,
			childrenName: type,
			config: {
				...empty.config,
				type,
				display: true,
				actions: [{ type: "configData", value: JSON.stringify(settings) }],
			},
		};
	};
	const obsProfile = {
		schemaVersion: 1,
		profiles: [
			{
				id: "obs",
				name: "OBS",
				revision: 0,
				pages: [
					{
						id: "one",
						keys: [
							obsKey("obsStream", "1,1", { mode: "toggle" }),
							obsKey("obsStats", "1,2", {}),
							obsKey("obsScreenshot", "1,4", {
								sourceName: "Main",
								sceneUuid: "deleted-scene",
							}),
						],
					},
				],
			},
		],
		activeByDevice: { "smoke-A": { profileId: "obs", pageId: "one" } },
	};
	await profiles.dispose();
	profiles = serveProfiles(
		Schema.encodeSync(ProfileEnvelope)(
			Schema.decodeUnknownSync(ProfileEnvelope)(obsProfile),
		),
	);
	await panel.loadFile(resolve("out/renderer/index.html"), {
		query: { surface: "panel" },
	});
	await settle(2500);
	const obsView: unknown = await panel.webContents.executeJavaScript(
		`(() => ({ count: document.querySelectorAll('.obs-tile').length, text: [...document.querySelectorAll('.obs-tile')].map((node) => node.textContent), image: !!document.querySelector('.obs-screenshot')?.naturalWidth, hidden: document.hidden }))()`,
	);
	assert(
		Schema.is(
			Schema.Struct({
				count: Schema.Number,
				text: Schema.Array(Schema.String),
				image: Schema.Boolean,
				hidden: Schema.Boolean,
			}),
		)(obsView),
	);
	assert.equal(obsView.count, 3);
	assert(
		obsView.text.some((text) => text.includes("LIVE")),
		JSON.stringify(obsView),
	);
	assert(
		obsView.text.some((text) => text.includes("CPU 12.3%")),
		JSON.stringify(obsView),
	);
	assert(obsView.image, JSON.stringify(obsView));
	assert.equal(
		await panel.webContents.executeJavaScript(`(() => {
		const tile = document.querySelector('.obs-tile');
		const label = tile.querySelector('span');
		const a = tile.getBoundingClientRect(), b = label.getBoundingClientRect();
		return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 2;
	})()`),
		true,
		"OBS state text must be vertically centered",
	);
	await management.webContents.executeJavaScript(
		`document.querySelector('.nav-item[title="Keys"]').click(); null;`,
	);
	await waitForVoice(
		management,
		`document.querySelector("#keys-profile")?.value === "obs" && document.querySelector('.keys-preview [data-key-code="1,4"] .obs-tile') !== null`,
	);
	await management.webContents.executeJavaScript(
		`([...document.querySelectorAll('.keys-cells button')].find(button => button.textContent === '1,4')).click(); null;`,
	);
	await waitForVoice(
		management,
		"document.querySelector('#obs-scene option[value=\"scene-1\"]') !== null",
	);
	// Live previews subscribe only while visible; the action library adds scrollable content.
	await management.webContents.executeJavaScript(
		`document.querySelector('.keys-preview').scrollIntoView({block:'center'}); null;`,
	);

	await waitForVoice(
		management,
		"document.querySelector('.keys-preview .obs-screenshot')?.naturalWidth > 0",
	);
	assert.equal(
		await management.webContents.executeJavaScript(
			`[...document.querySelectorAll('.keys-preview .obs-tile')].some(tile => tile.textContent.includes('CPU 12.3%'))`,
		),
		true,
		"Read-only management preview must show live OBS stats and decoded screenshots",
	);
	assert.equal(
		await management.webContents.executeJavaScript(
			`document.querySelector('#obs-scene option[value="deleted-scene"]').disabled`,
		),
		true,
		"Missing saved scene must remain as an unavailable option alongside replacements",
	);
	await management.webContents.executeJavaScript(`(() => {
		const select = document.querySelector('#obs-scene');
		select.value = 'scene-1'; select.dispatchEvent(new Event('change', {bubbles:true}));
	})()`);
	await settle(100);
	// The knob editor has its own primary Save button before the selected key.
	await management.webContents.executeJavaScript(
		`(() => {
		const button = document.querySelector('#key-function')?.closest('.group')?.querySelector('.button-primary');
		if (!(button instanceof HTMLButtonElement) || button.matches(':disabled')) throw new Error('Selected key Save is unavailable');
		button.click();
	})()`,
	);
	await waitForVoice(
		management,
		`document.querySelector('.key-editor')?.getAttribute('aria-busy') === 'false' && [...document.querySelectorAll('.key-editor > [role="status"]')].some(node => node.textContent === 'Saved successfully')`,
	);
	// KeyEditing.read includes drafts. Check the committed repository instead.
	const savedScreenshot = (
		await profiles.read()
	).profiles[0]?.pages[0]?.keys.find((key) => key.keyCode === "1,4");
	assert.deepEqual(
		Schema.decodeUnknownSync(Schema.parseJson(Schema.Unknown))(
			savedScreenshot?.config.actions[0]?.value,
		),
		{ sourceName: "Main", sceneUuid: "scene-1" },
		"Screenshot editor must commit the selected scene through production IPC",
	);
	if (artifacts)
		await writeFile(
			join(artifacts, "management-obs.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
	await waitForVoice(
		panel,
		"document.querySelector('.obs-screenshot')?.naturalWidth > 0",
	);
	await management.webContents.executeJavaScript(
		`([...document.querySelectorAll('.keys-cells button')].find(button => button.textContent === '1,6')).click(); null;`,
	);
	await waitForVoice(
		management,
		"document.querySelector('#key-function') !== null",
	);
	await management.webContents.executeJavaScript(`(() => {
		const select = document.querySelector('#key-function'); select.value = 'obsVolume';
		select.dispatchEvent(new Event('change', {bubbles:true}));
	})()`);
	await waitForVoice(
		management,
		"document.querySelector('#obs-input option[value=\"Desktop Audio\"]') !== null",
	);
	for (const type of ["obsMute", "obsVolume", "obsAudioMonitor", "obsMedia"]) {
		await management.webContents.executeJavaScript(`(() => {
			const select = document.querySelector('#key-function'); select.value = ${JSON.stringify(type)};
			select.dispatchEvent(new Event('change', {bubbles:true}));
		})()`);
		await waitForVoice(
			management,
			`document.querySelector('#obs-input option[value="${type === "obsMedia" ? "media-1" : "Desktop Audio"}"]') !== null`,
		);
		const values = await management.webContents.executeJavaScript(
			`Array.from(document.querySelector('#obs-input').options, option => option.value)`,
		);
		for (const id of type === "obsMedia"
			? ["media-1", "vlc-1"]
			: ["media-1", "vlc-1", "capture-1", "plugin-1", "Desktop Audio"])
			assert(
				values.includes(id),
				`${type} must list ${id}, got ${JSON.stringify(values)}`,
			);
		assert(
			!values.includes("image-1"),
			"Silent images must not appear in audio controls",
		);
	}
	await management.webContents.executeJavaScript(`(() => {
		const select = document.querySelector('#key-function'); select.value = 'obsVolume';
		select.dispatchEvent(new Event('change', {bubbles:true}));
	})()`);
	await waitForVoice(
		management,
		`document.querySelector('#obs-input option[value="Desktop Audio"]') !== null`,
	);
	await management.webContents.executeJavaScript(`(() => {
		const select = document.querySelector('#obs-input'); select.value = 'Desktop Audio';
		select.dispatchEvent(new Event('change', {bubbles:true}));
	})()`);
	await settle(100);
	await management.webContents.executeJavaScript(
		`(() => {
		const button = document.querySelector('#key-function')?.closest('.group')?.querySelector('.button-primary');
		if (!(button instanceof HTMLButtonElement) || button.matches(':disabled')) throw new Error('Selected key Save is unavailable');
		button.click();
	})()`,
	);
	await waitForVoice(
		management,
		`document.querySelector('.key-editor')?.getAttribute('aria-busy') === 'false' && [...document.querySelectorAll('.key-editor > [role="status"]')].some(node => node.textContent === 'Saved successfully')`,
	);
	const savedVolume = (await profiles.read()).profiles[0]?.pages[0]?.keys.find(
		(key) => key.keyCode === "1,6",
	);
	assert.equal(savedVolume?.config.type, "obsVolume");
	assert.equal(savedVolume?.config.supportKnob, true);
	assert.equal(
		Schema.decodeUnknownSync(
			Schema.parseJson(Schema.Struct({ inputUuid: Schema.String })),
		)(savedVolume?.config.actions[0]?.value).inputUuid,
		"Desktop Audio",
		"Volume editor must commit a knob-enabled special audio input",
	);
	await waitForVoice(
		panel,
		"document.querySelector('.obs-screenshot')?.naturalWidth > 0",
	);
	assert.deepEqual(
		await panel.webContents.executeJavaScript(
			`window.quakeObs.request({type:'configure', config:{host:'localhost',port:4455,autoConnect:false},password:'fixture-only'})`,
		),
		{
			type: "error",
			code: "OBS.IPC.REJECTED",
			message: "OBS request was rejected",
		},
		"Panel cannot mutate OBS credentials or connection settings",
	);
	assert.equal(
		(
			await panel.webContents.executeJavaScript(
				`window.quakeObs.request({type:'visible', lease:'forged', tiles:[{id:'1,4',command:{type:'obsScreenshot',settings:{sourceName:'Private'}}}]})`,
			)
		).type,
		"error",
		"Panel cannot request an uncommitted screenshot source",
	);
	if (artifacts)
		await writeFile(
			join(artifacts, "panel-obs.png"),
			(await panel.webContents.capturePage()).toPNG(),
		);
	const replacementObs = await fakeObsServer({
		scenes: [
			{ sceneUuid: "replacement-scene", sceneName: "Replacement scene" },
		],
		transitions: [{ transitionName: "Replacement transition" }],
		inputs: [
			{
				inputUuid: "replacement-input",
				inputName: "Replacement input",
				inputKind: "wasapi_input_capture",
			},
		],
	});
	const changeObsFunction = async (type: string) => {
		await management.webContents.executeJavaScript(`(() => {
			const select = document.querySelector('#key-function'); select.value = ${JSON.stringify(type)};
			select.dispatchEvent(new Event('change', {bubbles:true}));
		})()`);
		await settle(100);
	};
	const reconnectObs = async (host: string, port: number) => {
		await management.webContents.executeJavaScript(`(() => {
			const toggle = document.querySelector('.obs-controls button');
			if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
		})()`);
		await waitForVoice(
			management,
			"document.querySelector('#obs-port') !== null",
		);
		await management.webContents.executeJavaScript(`(() => {
			const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
			for (const [id, value] of [['obs-host', ${JSON.stringify(host)}], ['obs-port', '${port}']]) {
				const input = document.getElementById(id); set.call(input, value);
				input.dispatchEvent(new Event('input', {bubbles:true}));
			}
		})()`);
		await settle(50);
		await management.webContents.executeJavaScript(
			`[...document.querySelectorAll('.obs-connection button')].find(button => button.textContent === 'Connect').click(); null;`,
		);
		await waitForVoice(
			management,
			`document.querySelector('.obs-controls [role="status"]').textContent === 'Connected' && [...document.querySelectorAll('.obs-connection button')].some(button => button.textContent === 'Connect' && !button.disabled)`,
		);
	};
	try {
		await changeObsFunction("obsSource");
		await management.webContents.executeJavaScript(`(() => {
			const select = document.querySelector('#obs-scene'); select.value = 'scene-1';
			select.dispatchEvent(new Event('change', {bubbles:true}));
		})()`);
		await waitForVoice(
			management,
			`document.querySelector('#obs-item option[value="7"]') !== null`,
		);
		obsServer.delay("GetSceneItemList", 600);
		await management.webContents.executeJavaScript(`(() => {
			const select = document.querySelector('#obs-scene'); select.value = 'scene-2';
			select.dispatchEvent(new Event('change', {bubbles:true}));
		})()`);
		await waitForVoice(
			management,
			`document.querySelector('#obs-scene').value === 'scene-2'`,
		);
		assert.equal(
			await management.webContents.executeJavaScript(
				`document.querySelector('#obs-item option[value="7"]') === null && document.querySelector('#obs-item option[value="42"]') === null`,
			),
			true,
			"Changing scenes clears source choices before the delayed new catalog arrives",
		);
		await waitForVoice(
			management,
			`document.querySelector('#obs-item option[value="42"]') !== null`,
		);
		obsServer.delay("GetSceneItemList", 0);
		process.stdout.write(
			"OBS scene regression PASS: old sources clear during delayed scene-item loading.\n",
		);
		await changeObsFunction("obsSceneTransitionOverride");
		await waitForVoice(
			management,
			`document.querySelector('#obs-scene option[value="scene-1"]') !== null`,
		);
		await reconnectObs("localhost", replacementObs.port);
		assert.equal(
			replacementObs.connections(),
			1,
			"Connect must actually establish the replacement endpoint",
		);
		await waitForVoice(
			management,
			`document.querySelector('#obs-scene option[value="replacement-scene"]') !== null`,
		);
		assert.equal(
			await management.webContents.executeJavaScript(`(() => {
				const values = [...document.querySelectorAll('.obs-connection select option')].map(option => option.value);
				return values.includes('Replacement transition') && !values.includes('scene-1') && !values.includes('Fade');
			})()`),
			true,
			"Connected-to-connected reconnect must replace scene and transition choices",
		);
		await changeObsFunction("obsVolume");
		await waitForVoice(
			management,
			`document.querySelector('#obs-input option[value="replacement-input"]') !== null`,
		);
		assert.equal(
			await management.webContents.executeJavaScript(
				`document.querySelector('#obs-input option[value="plugin-1"]') === null`,
			),
			true,
			"Reconnect must remove the previous instance's input choices",
		);
		const catalogCalls = obsServer.calls.filter(
			(call) => call.type === "GetSceneList",
		).length;
		obsServer.fail(["GetSceneList"]);
		await reconnectObs("127.0.0.1", obsServer.port);
		await waitForVoice(
			management,
			`document.querySelector('#obs-input option[value="replacement-input"]') === null`,
		);
		assert(
			obsServer.calls.filter((call) => call.type === "GetSceneList").length >
				catalogCalls,
			"Reconnect must attempt a fresh catalog even when loading fails",
		);
		if (artifacts)
			await writeFile(
				join(artifacts, "management-obs-reconnect.png"),
				(await management.webContents.capturePage()).toPNG(),
			);
		process.stdout.write(
			"OBS reconnect regression PASS: changed host/port replaces scenes, inputs and transitions; failed reload clears old targets.\n",
		);
	} finally {
		obsServer.fail([]);
		await replacementObs.close();
	}
	await panel.loadURL("about:blank");
	await management.loadURL("about:blank");
	await settle(50);
	const obsCalls = obsServer.calls.length;
	await settle(2100);
	assert.equal(
		obsServer.calls.length,
		obsCalls,
		"Released OBS profile must stop polling",
	);
	await obsRegistration.dispose();
	await obsServer.close();
	await management.loadFile(resolve("out/renderer/index.html"));
	process.stdout.write(
		"OBS native smoke PASS: production preload, status/stats/jpeg tiles, fixed spans, renderer navigation stops polling.\n",
	);
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
		if (name === "clock")
			await waitForVoice(panel, "!!document.querySelector('.oq-clock')");
		const shown: unknown = await panel.webContents.executeJavaScript(
			`(() => ({ theme: document.querySelector('.strip-grid')?.dataset.theme, vivid: document.querySelector('.strip-screen')?.dataset.vivid, clock: !!document.querySelector('.oq-clock') }))()`,
		);
		assert.deepEqual(shown, {
			theme,
			vivid: theme === undefined ? "true" : "false",
			clock: name === "clock",
		});
		if (theme !== undefined) {
			const stripStyles: unknown = await panel.webContents.executeJavaScript(
				`(() => {
					const screen = document.querySelector('.strip-screen');
					const grid = screen.querySelector('.strip-grid');
					const empty = grid.querySelector('[data-state="empty"]');
					return {
						isolation: getComputedStyle(screen).isolation,
						gridLayer: getComputedStyle(grid).zIndex,
						logicalSize: [screen.style.width, screen.style.height],
						emptyBorder: empty ? getComputedStyle(empty).borderTopWidth : null,
						bodyCount: grid.querySelectorAll('[data-state="tile"]').length,
						flat: [...grid.querySelectorAll('[data-state="tile"]')].every(slot => getComputedStyle(slot).backgroundColor === 'rgb(21, 23, 26)')
					};
				})()`,
			);
			assert.deepEqual(stripStyles, {
				isolation: "isolate",
				gridLayer: "10",
				logicalSize: ["1920px", "480px"],
				emptyBorder: name === "quick" || name === "spans" ? "2px" : null,
				bodyCount: profile.pages[0].keys.filter(
					(key) => key.config.display && key.config.type !== "",
				).length,
				flat: true,
			});
		}
		if (name === "vivid" && process.env.OPEN_QUAKE_SMOKE_VIDEO) {
			selectedPath = process.env.OPEN_QUAKE_SMOKE_VIDEO;
			const imported = await request(management, {
				_tag: "import",
				serial: "smoke-A",
				revision: (await request(management, { _tag: "read" })).saved.revision,
			});
			assert.equal(imported.saved.settings.displayMediaList[0]?.type, "video");
			assert.equal(imported.asset._tag, "ready");
			await request(management, {
				_tag: "sound",
				serial: "smoke-A",
				revision: imported.saved.revision,
				enableSound: true,
			});
			await settle(3600);
			const video: unknown = await panel.webContents.executeJavaScript(`(() => {
    const video = document.querySelector('.wallpaper-canvas video');
    return { loop: video?.loop, playing: video && !video.paused, advanced: video?.currentTime > 0, ready: video?.readyState >= 2 };
   })()`);
			assert.deepEqual(video, {
				loop: true,
				playing: true,
				advanced: true,
				ready: true,
			});
			// A late panel mount must join the controller's existing playback position.
			const running = await request(management, { _tag: "read" });
			assert.notEqual(running.playbackStartedAt, undefined);
			await panel.reload();
			await settle(1200);
			const timing: { position: number; duration: number } =
				await panel.webContents.executeJavaScript(`(() => {
        const video = document.querySelector('.wallpaper-canvas video');
        return { position: video?.currentTime, duration: video?.duration };
      })()`);
			const stillRunning = await request(management, { _tag: "read" });
			assert.equal(stillRunning.playbackStartedAt, running.playbackStartedAt);
			assert.equal(stillRunning.playbackId, running.playbackId);
			const expected =
				((Date.now() - (running.playbackStartedAt ?? 0)) / 1000) %
				timing.duration;
			const drift = Math.abs(timing.position - expected);
			assert(
				Math.min(drift, timing.duration - drift) < 0.7,
				`Late mount drift ${drift}s`,
			);
			assert.equal(panel.webContents.isAudioMuted(), true);
			assert.equal(management.webContents.isAudioMuted(), true);
			process.stdout.write(
				"Cluster 18 native video PASS: managed import, metadata, real renderer playback and singleton loop; all windows muted.\n",
			);
		}

		if (artifacts)
			await writeFile(
				join(artifacts, `panel-${name}.png`),
				(await panel.webContents.capturePage()).toPNG(),
			);
	}

	// media-native: real renderer/preload with injected media and no host control.
	const playerBase = Schema.encodeSync(ProfileKey)(
		createEmptyProfileKey("1,1"),
	);
	const playerProfile: typeof Profile.Encoded = {
		id: "media-smoke",
		name: "Media",
		revision: 1,
		pages: [
			{
				id: "one",
				keys: [
					{
						...playerBase,
						childrenName: "playAudio",
						config: {
							...playerBase.config,
							type: "playAudio",
							size: [5, 2],
							actions: [
								{ type: "sound", value: "" },
								{ type: "audioAction", value: 0 },
								{ type: "musicSource", value: "system" },
							],
						},
					},
				],
			},
		],
	};
	await profiles.dispose();
	profiles = serveProfiles(stripFixtureEnvelope(playerProfile, "smoke-A"));
	for (const language of ["en", "de"]) {
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await management.webContents.executeJavaScript(
			`window.quakeLocale.set('${language}')`,
		);
		await panel.reload();
		await settle(600);
		const player = await panel.webContents.executeJavaScript(
			`(() => ({card:!!document.querySelector('[data-testid="dk-player"]'),source:document.querySelector('.oq-player-source')?.textContent,title:document.querySelector('.oq-player-title')?.textContent,clamp:getComputedStyle(document.querySelector('.oq-player-error') || document.body).webkitLineClamp}))()`,
		);
		assert.equal(player.card, true);
		assert.equal(player.source, "Music");
		if (artifacts)
			await writeFile(
				join(artifacts, `media-native-${language}.png`),
				(await panel.webContents.capturePage()).toPNG(),
			);
	}
	const localProfile = {
		...playerProfile,
		pages: playerProfile.pages.map((page) => ({
			...page,
			keys: page.keys.map((key) => ({
				...key,
				config: {
					...key.config,
					actions:
						key.config.actions?.map((a) =>
							a.type === "musicSource" ? { ...a, value: "local" } : a,
						) ?? [],
				},
			})),
		})),
	};
	await profiles.dispose();
	profiles = serveProfiles(
		stripFixtureEnvelope(
			{
				...localProfile,
				pages: [localProfile.pages[0] ?? playerProfile.pages[0]],
			},
			"smoke-A",
		),
	);
	for (const language of ["en", "de"]) {
		await management.webContents.executeJavaScript(
			`window.quakeLocale.set('${language}')`,
		);
		await panel.reload();
		await settle(600);
		const status = await panel.webContents.executeJavaScript(
			"document.querySelector('.oq-player-error')?.textContent",
		);
		assert.equal(
			status,
			language === "de" ? "Nicht konfiguriert" : "Not configured",
		);
		if (artifacts)
			await writeFile(
				join(artifacts, `media-native-local-${language}.png`),
				(await panel.webContents.capturePage()).toPNG(),
			);
	}

	process.stdout.write(
		"media-native smoke PASS: production IPC/rendering, retained source label, EN/DE screenshots; no real media session or audio.\n",
	);
	await management.webContents.executeJavaScript(
		"window.quakeLocale.set('en')",
	);
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
			token: "#f5f4f1",
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
	await knob.dispose();
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
		// ClawBot now has production sub-targets. Isolate this synthetic registry probe.
		for (const target of tile.querySelectorAll('[data-quake-sub-touch]')) target.removeAttribute('data-quake-sub-touch');
		const scroll = document.createElement('div');
		scroll.dataset.quakeSubTouch = 'scroll'; scroll.dataset.supportQuakeMove = 'true';
		scroll.style.cssText = 'position:absolute;inset:0'; tile.appendChild(scroll);
		for (const phase of ['start', 'end']) scroll.addEventListener('quake-sub-touch-' + phase, e => window.__subTouch.push(e.detail));
	})()`);
	await settle(50);
	mockTouch.emitTouchReport(touchAt(1800, 360));
	mockTouch.emitTouchReport(SYNTHETIC_TOUCH_EMPTY);
	await waitForVoice(
		panel,
		"window.__subTouch.at(-1)?.subElementId === 'scroll'",
	);
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
	await waitForVoice(panel, "window.__subTouch.length >= 4");
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
	removeDeviceReady();
	unregisterHardware();
	ipcMain.removeHandler(AGENTS_REQUEST);
	removeAppearance();
	assert.equal(
		weatherRequests,
		0,
		"disabled weather never requests network IO",
	);
	await weatherMedia.dispose();
	await maintenance.dispose();
	removeLifecycle();
	await lifecycleRuntime.dispose();
	await profiles.dispose();
	await locale.dispose();
	await clock.dispose();
	await meetings.dispose();
	await voice.dispose();
	await monitor.dispose();
	management.destroy();
	panel.destroy();
	process.stdout.write(
		"W6 Electron smoke PASS: spoofed panel mutations rejected, native PNG/JPEG decoding, isolated serials, real preload/IPC, three fill modes, synchronized one-second clock, light theme/reduced motion, hidden panel/preview, strip key grid for five built-in-like profiles. Hardware unverified.\n",
	);
}

// Fail headlessly on native callback errors instead of opening Electron's modal dialog.
const fatal = (cause: unknown): void => {
	process.stderr.write(
		`${cause instanceof Error ? cause.stack : String(cause)}\n`,
	);
	app.exit(1);
};
process.on("uncaughtException", fatal);
process.on("unhandledRejection", fatal);

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
