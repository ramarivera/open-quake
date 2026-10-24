/** Run with Electron, not Node. Both app windows stay hidden. See README.md. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow, dialog, nativeImage } from "electron";
import type { EncodedProfileEnvelope } from "../../shared/profiles";
import {
	type WallpaperCommand,
	WallpaperReply,
	type WallpaperSnapshot,
} from "../../shared/wallpaper-contracts";
import { ProfilesLive, registerProfiles } from "../profiles/profile-ipc";
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
