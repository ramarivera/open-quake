/**
 * Native clock smoke. Run with Electron, not Node; every window stays hidden
 * and no HID device is opened. Optional argv[2]: absolute screenshot folder.
 *
 *   pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/clock/smoke.config.ts
 *   env -u ELECTRON_RUN_AS_NODE pnpm --filter @open-quake/desktop exec electron out/clock-smoke/smoke.js <dir>
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow, dialog, ipcMain, nativeImage } from "electron";
import { SYNTHETIC_TOUCH_EMPTY } from "../../../../../packages/device/src/touch/touch-fixtures";
import {
	type ClockCommand,
	ClockReply,
	type ClockSnapshot,
} from "../../shared/clock-contracts";
import { THEME_IDS } from "../../shared/clock-style";
import { WALLPAPER_REQUEST } from "../../shared/wallpaper-contracts";
import { MediaLive, registerMedia } from "../media";
import { startMockDeviceBus } from "../mockDeviceBus";
import { ProfilesLive, registerProfiles } from "../profiles/profile-ipc";
import { clockProfile, stripFixtureEnvelope } from "../test/strip-fixtures";
import { ClockLive, registerClock, registerClockScheme } from "./index";

registerClockScheme();
const artifacts = process.argv[2];
// Chromium opens its profile at ready, so the throwaway userData comes first.
const base = mkdtempSync(
	join(process.env.OPEN_QUAKE_SCRATCH ?? tmpdir(), "oq-clock-smoke-"),
);
app.setPath("userData", base);
// Chromium keeps writing its profile until exit, so remove it last.
process.once("exit", () => rmSync(base, { recursive: true, force: true }));
let picked = "";
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });

const sleep = (ms: number): Promise<void> =>
	new Promise((done) => setTimeout(done, ms));

async function evaluate(
	window: BrowserWindow,
	script: string,
): Promise<unknown> {
	return window.webContents.executeJavaScript(script);
}

async function waitFor(
	window: BrowserWindow,
	script: string,
	what: string,
	timeoutMs = 8000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if ((await evaluate(window, script)) === true) return;
		await sleep(50);
	}
	throw new Error(`Timed out waiting for ${what}`);
}

async function request(
	window: BrowserWindow,
	command: ClockCommand,
): Promise<ClockReply> {
	const reply: unknown = await evaluate(
		window,
		`window.quakeClock.request(${JSON.stringify(command)})`,
	);
	assert(Schema.is(ClockReply)(reply), JSON.stringify(reply));
	return reply;
}

async function snapshotOf(window: BrowserWindow): Promise<ClockSnapshot> {
	const reply = await request(window, { _tag: "read" });
	assert.equal(reply._tag, "success");
	if (reply._tag !== "success") throw new Error("read failed");
	return reply.snapshot;
}

async function capture(window: BrowserWindow, name: string): Promise<void> {
	if (!artifacts) return;
	await sleep(250);
	await writeFile(
		join(artifacts, `${name}.png`),
		(await window.webContents.capturePage()).toPNG(),
	);
}

const themeIs = (id: string): string =>
	`document.querySelector('.oq-clock')?.dataset.theme === ${JSON.stringify(id)}`;
const backgroundIs = (kind: string): string =>
	`document.querySelector('.oq-clock-bg')?.dataset.background === ${JSON.stringify(kind)}`;
const builtinReady = `(() => { const img = document.querySelector('.oq-clock-bg img[data-source="builtin"]'); return !!img && img.complete && img.naturalWidth > 0; })()`;

/** A WebM recorded from a canvas, so the smoke needs no fixture files. */
async function recordVideo(window: BrowserWindow, ms: number): Promise<Buffer> {
	const base64: unknown = await evaluate(
		window,
		`(async () => {
			const canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 160 });
			const ctx = canvas.getContext('2d');
			const stream = canvas.captureStream(30);
			const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
			const chunks = [];
			recorder.ondataavailable = (e) => chunks.push(e.data);
			const done = new Promise((r) => (recorder.onstop = r));
			let frame = 0;
			const timer = setInterval(() => {
				const g = ctx.createLinearGradient(0, 0, 640, 0);
				g.addColorStop(0, 'hsl(' + (frame * 4) % 360 + ',70%,30%)');
				g.addColorStop(1, 'hsl(' + (frame * 4 + 120) % 360 + ',70%,20%)');
				ctx.fillStyle = g; ctx.fillRect(0, 0, 640, 160); frame++;
			}, 33);
			recorder.start(250);
			await new Promise((r) => setTimeout(r, ${ms}));
			recorder.stop(); await done; clearInterval(timer);
			const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
			let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
			return btoa(binary);
		})()`,
	);
	assert(typeof base64 === "string" && base64.length > 100);
	return Buffer.from(base64, "base64");
}

async function smoke(): Promise<void> {
	await app.whenReady();
	try {
		if (artifacts) await mkdir(artifacts, { recursive: true });
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
				backgroundThrottling: false,
			},
		};
		const management = new BrowserWindow(options);
		const panel = new BrowserWindow(options);
		let wallpaperReads = 0;
		const originalHandle = ipcMain.handle.bind(ipcMain);
		ipcMain.handle = (channel, listener): void =>
			originalHandle(channel, (event, input: unknown) => {
				if (
					channel === WALLPAPER_REQUEST &&
					event.sender === management.webContents &&
					typeof input === "object" &&
					input !== null &&
					"_tag" in input &&
					input._tag === "read"
				)
					wallpaperReads++;
				return listener(event, input);
			});
		const media = registerMedia(
			ManagedRuntime.make(MediaLive(join(base, "wallpaper-v1"))),
			() => management,
		);
		ipcMain.handle = originalHandle;
		const clock = registerClock(
			ManagedRuntime.make(ClockLive(base)),
			() => management,
		);
		// The strip renders the active profile; serve DK-Suite's clock profile.
		const envelope = stripFixtureEnvelope(clockProfile);
		const profiles = registerProfiles(
			ManagedRuntime.make(
				ProfilesLive({
					read: async () => structuredClone(envelope),
					write: async () => undefined,
				}),
			),
			pathToFileURL(resolve("out/renderer/index.html")).href,
		);
		await Promise.all([
			management.loadFile(resolve("out/renderer/index.html")),
			panel.loadFile(resolve("out/renderer/index.html"), {
				query: { surface: "panel" },
			}),
		]);
		await waitFor(
			management,
			`!!document.querySelector('.device-overview') || !!document.querySelector('.nav-item')`,
			"management mounted",
		);
		await sleep(150);
		const readsBeforeScreen = wallpaperReads;
		await waitFor(
			management,
			`(() => { const b = [...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('Screen')); b?.click(); return !!b; })()`,
			"management Screen page",
		);
		await waitFor(
			panel,
			`!!document.querySelector('.oq-clock')`,
			"panel clock",
		);

		await waitFor(
			management,
			`!!document.querySelector('.clock-settings .oq-clock')`,
			"clock settings preview",
		);
		assert.equal(
			wallpaperReads,
			readsBeforeScreen,
			"Screen reuses the parent's wallpaper subscription",
		);
		process.stdout.write("shared wallpaper snapshot PASS\n");

		// Defaults: season, minutes only, DK geometry with no cards.
		const initial = await snapshotOf(panel);
		assert.equal(initial.mode, "theme");
		assert.equal(initial.themeId, "season");
		assert.equal(initial.showSeconds, false);
		const geometry = await evaluate(
			panel,
			`(() => { const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; }; return { rail: r('.oq-clock-rail'), flip: r('.oq-flip-clock'), card: r('.oq-flip'), cards: document.querySelector('.oq-clock-cards').children.length, pills: document.querySelectorAll('.oq-flip-pill').length }; })()`,
		);
		assert.deepEqual(geometry, {
			rail: [80, 90, 240, 300],
			flip: [726, 90, 708, 300],
			card: [726, 90, 160, 300],
			cards: 0,
			pills: 0,
		});
		process.stdout.write("geometry PASS\n");

		// The minute flip in a real compositor: shift the page clock to the
		// next minute and wake the ticker as a resume would.
		const flipTrace = `(() => {
			const Real = Date;
			const shift = (60 - new Real().getSeconds()) * 1000 + 50;
			window.Date = class extends Real {
				constructor(...a) { a.length ? super(...a) : super(Real.now() + shift); }
				static now() { return Real.now() + shift; }
			};
			Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
			const card = document.querySelectorAll('.oq-flip')[3];
			window.__flip = [];
			const t0 = performance.now();
			new MutationObserver(() => {
				const upper = card.querySelector('.oq-flip-upper');
				window.__flip.push([card.dataset.flip, Math.round(performance.now() - t0), upper.getAnimations().map((a) => a.animationName).join()]);
			}).observe(card, { attributes: true, attributeFilter: ['data-flip'] });
			document.dispatchEvent(new Event('visibilitychange'));
			return null;
		})()`;
		const timeNow = `document.querySelector('.oq-flip-clock').dataset.time`;
		await evaluate(panel, flipTrace);
		await sleep(190);
		await capture(panel, "clock-flip-phase1");
		await waitFor(panel, `window.__flip.length === 3`, "two flip phases");
		const trace: unknown = await evaluate(panel, "window.__flip");
		assert(Array.isArray(trace) && trace.length === 3, JSON.stringify(trace));
		const [on, down, rest] = trace;
		assert(Array.isArray(on) && Array.isArray(down) && Array.isArray(rest));
		assert.deepEqual(
			[on[0], down[0], rest[0]],
			["turn-on", "turn-down", "rest"],
		);
		assert.equal(on[2], "oq-flip-on");
		assert.equal(down[2], "oq-flip-down");
		const phase1 = Number(down[1]) - Number(on[1]);
		const phase2 = Number(rest[1]) - Number(down[1]);
		assert(
			Math.abs(phase1 - 380) < 80 && Math.abs(phase2 - 380) < 80,
			JSON.stringify(trace),
		);
		process.stdout.write(`minute flip PASS (${phase1} ms + ${phase2} ms)\n`);
		await evaluate(
			panel,
			`document.documentElement.dataset.motion = 'reduce'; null`,
		);
		await sleep(50);
		const before = await evaluate(panel, timeNow);
		await evaluate(panel, flipTrace);
		await sleep(500);
		assert.notEqual(await evaluate(panel, timeNow), before, "minute changed");
		assert.deepEqual(
			await evaluate(panel, "window.__flip.map((f) => f[0])"),
			[],
			"reduced motion switches without a flip",
		);
		await evaluate(
			panel,
			`delete document.documentElement.dataset.motion; null`,
		);
		process.stdout.write("reduced motion PASS\n");

		// Every theme, switched from the strip itself.
		for (const id of THEME_IDS) {
			const reply = await request(panel, {
				_tag: "setTheme",
				keyCode: "1,1",
				themeId: id,
			});
			assert.equal(reply._tag, "success");
			await waitFor(panel, themeIs(id), `theme ${id}`);
			await waitFor(panel, builtinReady, `${id} art`);
			await capture(panel, `clock-${id}`);
		}
		process.stdout.write("five themes PASS\n");

		// ◀/▶ on the strip: wrap, persistence and broadcast to management.
		await evaluate(
			panel,
			`document.querySelector('[data-testid="clock-theme-next"]').click()`,
		);
		await waitFor(panel, themeIs("season"), "wrap aurora → season");
		await waitFor(
			management,
			`document.querySelector('.clock-settings .oq-clock')?.dataset.theme === 'season'`,
			"management preview follows the strip",
		);
		assert.equal((await snapshotOf(panel)).themeId, "season");
		process.stdout.write("strip theme switch PASS\n");

		// Real mounted sub-touch registry, with parser/tracker and preload IPC.
		const mockTouch = startMockDeviceBus();
		const offTouch = mockTouch.on((event) => {
			if (event.kind === "touch") panel.webContents.send("quake:event", event);
		});
		try {
			for (const [direction, expected] of [
				["next", "cyber"],
				["prev", "season"],
			] as const) {
				const center = await evaluate(
					panel,
					`(() => { const r = document.querySelector('[data-quake-sub-touch="clock-theme-${direction}"]').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`,
				);
				assert(
					Array.isArray(center) &&
						typeof center[0] === "number" &&
						typeof center[1] === "number",
				);
				const [x, y] = center;
				const beforeTouch = await snapshotOf(panel);
				const rawY = 480 - y;
				mockTouch.emitTouchReport(
					new Uint8Array([
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
					]),
				);
				mockTouch.emitTouchReport(SYNTHETIC_TOUCH_EMPTY);
				await waitFor(panel, themeIs(expected), `sub-touch ${direction}`);
				await sleep(100);
				const saved = await snapshotOf(panel);
				assert.equal(saved.themeId, expected);
				assert.equal(
					saved.revision,
					beforeTouch.revision + 1,
					"one save per effective tap",
				);
			}
		} finally {
			offTouch();
			mockTouch.stop();
		}
		process.stdout.write("clock sub-touch navigation PASS\n");

		// Save failure: the preview shows, then rolls back.
		const dir = join(base, "clock-v1");
		await chmod(dir, 0o555);
		await evaluate(
			panel,
			`window.__themes = []; new MutationObserver(() => window.__themes.push(document.querySelector('.oq-clock').dataset.theme)).observe(document.querySelector('.oq-clock'), { attributes: true, attributeFilter: ['data-theme'] }); document.querySelector('[data-testid="clock-theme-next"]').click(); null`,
		);
		await waitFor(
			panel,
			`window.__themes.includes('cyber')`,
			"optimistic preview",
		);
		await waitFor(panel, themeIs("season"), "rollback to season");
		await chmod(dir, 0o755);
		assert.equal((await snapshotOf(panel)).themeId, "season");
		process.stdout.write("save failure rollback PASS\n");

		// None: solid background, "—" label.
		await request(management, { _tag: "setMode", mode: "none" });
		await waitFor(panel, themeIs("none"), "none mode");
		assert.equal(
			await evaluate(
				panel,
				`document.querySelector('.oq-clock-nav-name').textContent`,
			),
			"—",
		);
		await capture(panel, "clock-none");
		await request(management, { _tag: "setMode", mode: "theme" });

		// 12h with seconds.
		const wallpaper: unknown = await evaluate(
			management,
			`window.quakeWallpaper.request({ _tag: 'read' })`,
		);
		assert(
			typeof wallpaper === "object" &&
				wallpaper !== null &&
				"snapshot" in wallpaper &&
				typeof wallpaper.snapshot === "object" &&
				wallpaper.snapshot !== null &&
				"saved" in wallpaper.snapshot,
		);
		await evaluate(
			management,
			`(async () => { const r = await window.quakeWallpaper.request({ _tag: 'read' }); const s = r.snapshot.saved; return window.quakeWallpaper.request({ _tag: 'configure', serial: s.serial, revision: s.revision, fillMode: s.settings.bgFillMode, hourFormat: '12h' }); })()`,
		);
		await request(management, { _tag: "setSeconds", showSeconds: true });
		await request(panel, {
			_tag: "setTheme",
			keyCode: "1,1",
			themeId: "aurora",
		});
		await waitFor(
			panel,
			`document.querySelectorAll('.oq-flip-pill').length === 2 && /^(AM|PM)$/.test(document.querySelector('.oq-flip-pill').textContent)`,
			"AM/PM and seconds pills",
		);
		const s1 = await evaluate(
			panel,
			`document.querySelector('.is-seconds').textContent`,
		);
		await sleep(1100);
		const s2 = await evaluate(
			panel,
			`document.querySelector('.is-seconds').textContent`,
		);
		assert.notEqual(s1, s2, "seconds tick");
		await capture(panel, "clock-aurora-12h-seconds");
		await request(management, { _tag: "setSeconds", showSeconds: false });
		process.stdout.write("12h + seconds PASS\n");

		// Custom image on cyber through the management dialog.
		const imagePath = join(base, "custom.png");
		const pixels = Buffer.alloc(960 * 240 * 4);
		for (let y = 0; y < 240; y++)
			for (let x = 0; x < 960; x++) {
				const o = (y * 960 + x) * 4;
				pixels[o] = 40 + Math.round((x / 960) * 180);
				pixels[o + 1] = 30;
				pixels[o + 2] = 120 + Math.round((y / 240) * 100);
				pixels[o + 3] = 255;
			}
		await writeFile(
			imagePath,
			nativeImage.createFromBitmap(pixels, { width: 960, height: 240 }).toPNG(),
		);
		picked = imagePath;
		const chosen = await request(management, {
			_tag: "chooseMedia",
			themeId: "cyber",
		});
		assert.equal(chosen._tag, "success");
		if (chosen._tag !== "success") throw new Error("choose failed");
		assert.equal(chosen.snapshot.media.cyber?.kind, "image");
		assert.equal(chosen.snapshot.media.cyber?.name, "custom.png");
		assert.equal(
			JSON.stringify(chosen.snapshot).includes(base),
			false,
			"no paths",
		);
		await request(panel, {
			_tag: "setTheme",
			keyCode: "1,1",
			themeId: "cyber",
		});
		await waitFor(
			panel,
			`(() => { const img = document.querySelector('.oq-clock-bg img[data-source="custom"]'); return !!img && img.complete && img.naturalWidth === 960; })()`,
			"custom image via oq-clock-media",
		);
		await capture(panel, "clock-cyber-custom-image");
		const forged = await evaluate(
			panel,
			`fetch('oq-clock-media://theme/..%2F..%2Fetc%2Fpasswd').then(r => r.status, () => 'blocked')`,
		);
		assert.notEqual(forged, 200);
		process.stdout.write("custom image PASS\n");

		// Custom video on aurora: dialog → duration probe → commit → plays.
		const videoPath = join(base, "loop.webm");
		await writeFile(videoPath, await recordVideo(management, 3000));
		picked = videoPath;
		await evaluate(
			management,
			`document.querySelector('.clock-theme-card[data-theme="aurora"] .button-row button').click()`,
		);
		await waitFor(
			panel,
			`(async () => (await window.quakeClock.request({ _tag: 'read' })).snapshot.media.aurora?.kind === 'video')()`,
			"video committed after probe",
			15000,
		);
		await request(panel, {
			_tag: "setTheme",
			keyCode: "1,1",
			themeId: "aurora",
		});
		await waitFor(
			panel,
			`(() => { const v = document.querySelector('.oq-clock-bg video'); return !!v && !v.paused && v.readyState >= 2; })()`,
			"custom video playing",
			10000,
		);
		assert.equal(await evaluate(panel, backgroundIs("video")), true);
		await capture(panel, "clock-aurora-custom-video");
		process.stdout.write("custom video PASS\n");

		// A broken custom video falls back to aurora's built-in art.
		await writeFile(videoPath, Buffer.from("not a video"));
		await request(management, { _tag: "setSeconds", showSeconds: false });
		await request(management, { _tag: "setSeconds", showSeconds: true });
		await request(management, { _tag: "setSeconds", showSeconds: false });
		await waitFor(panel, backgroundIs("builtin"), "fallback to built-in", 7000);
		assert.equal(
			await evaluate(
				panel,
				`document.querySelector('.oq-clock-bg img').dataset.theme`,
			),
			"aurora",
		);
		await capture(panel, "clock-aurora-fallback");
		process.stdout.write("broken media fallback PASS\n");

		// A too-short video is refused with DK-Suite's message.
		const shortPath = join(base, "short.webm");
		await writeFile(shortPath, await recordVideo(management, 1000));
		picked = shortPath;
		await evaluate(
			management,
			`document.querySelector('.clock-theme-card[data-theme="tactical"] .button-row button').click()`,
		);
		await waitFor(
			management,
			`document.querySelector('.clock-settings [role="status"]')?.textContent.includes('Video duration too short, should be longer than 2 seconds.')`,
			"short video refused",
			15000,
		);
		assert.equal((await snapshotOf(panel)).media.tactical, undefined);
		process.stdout.write("short video refused PASS\n");

		// The management bridge cannot forge a longer duration for that file.
		const stagedShort = await request(management, {
			_tag: "chooseMedia",
			themeId: "tactical",
		});
		assert(stagedShort._tag === "candidate");
		const forgedDuration = await request(management, {
			_tag: "commitMedia",
			token: stagedShort.token,
			durationMs: 60_000,
		});
		assert.equal(forgedDuration._tag, "failure");
		if (forgedDuration._tag === "failure")
			assert.equal(forgedDuration.code, "QUAKE.CLOCK.MEDIA_TOO_SHORT");
		assert.equal((await snapshotOf(panel)).media.tactical, undefined);
		process.stdout.write("forged video duration refused PASS\n");

		// Missing file: management marks the slot, the strip shows built-in art.
		await rm(imagePath);
		const missing = await snapshotOf(management);
		assert.equal(missing.media.cyber?.available, false);
		await request(panel, {
			_tag: "setTheme",
			keyCode: "1,1",
			themeId: "cyber",
		});
		await waitFor(
			panel,
			`${themeIs("cyber")} && ${backgroundIs("builtin")}`,
			"missing → built-in",
		);
		await waitFor(
			management,
			`!!document.querySelector('.clock-theme-card[data-theme="cyber"] .clock-theme-missing')`,
			"missing marker",
		);
		process.stdout.write("missing media PASS\n");

		if (artifacts) {
			management.setSize(1100, 1400);
			await evaluate(
				management,
				`document.querySelector('.clock-settings').scrollIntoView(); null`,
			);
			await capture(management, "management-clock");
			management.setSize(390, 844);
			await sleep(150);
			await evaluate(
				management,
				`document.querySelector('.clock-settings').scrollIntoView(); null`,
			);
			assert.equal(
				await evaluate(
					management,
					"document.documentElement.scrollWidth > innerWidth",
				),
				false,
				"narrow management must not overflow",
			);
			await capture(management, "management-clock-narrow");
		}
		// A formerly trusted window loses media access after navigating away.
		await writeFile(
			imagePath,
			nativeImage.createFromBitmap(pixels, { width: 960, height: 240 }).toPNG(),
		);
		picked = imagePath;
		await request(management, { _tag: "chooseMedia", themeId: "cyber" });
		const probeUrl = (await snapshotOf(panel)).media.cyber?.url;
		assert(probeUrl);
		const imageProbe = `new Promise(resolve => { const image = new Image(); image.onload = () => resolve(image.naturalWidth); image.onerror = () => resolve("blocked"); image.src = ${JSON.stringify(probeUrl)}; })`;
		assert.equal(
			await evaluate(panel, imageProbe),
			960,
			"app can read the same valid media URL",
		);
		await panel.loadURL("data:text/html,<title>Unrelated document</title>");
		const mediaAfterNavigation = await evaluate(panel, imageProbe);
		assert.equal(mediaAfterNavigation, "blocked");
		process.stdout.write("media denied after navigation PASS\n");

		management.destroy();
		panel.destroy();
		await clock.dispose();
		await profiles.dispose();
		await media.dispose();
		process.stdout.write(
			"Clock Electron smoke PASS: DK geometry, 2×380 ms minute flip, reduced motion, five themes, strip ◀/▶ save + rollback, None, 12h + seconds, custom image/video over oq-clock-media, broken-media fallback, missing-file marker. Hardware unverified.\n",
		);
	} finally {
		await chmod(join(base, "clock-v1"), 0o755).catch(() => {});
	}
}

smoke()
	.then(() => app.exit(0))
	.catch((cause: unknown) => {
		process.stderr.write(
			`${cause instanceof Error ? cause.stack : String(cause)}\n`,
		);
		app.exit(1);
	});
