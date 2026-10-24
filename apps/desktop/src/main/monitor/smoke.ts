/** Native Electron proof. Hidden windows, mock touch, no HID imports or opens. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow, dialog, ipcMain, nativeImage } from "electron";
import { SYNTHETIC_TOUCH_EMPTY } from "../../../../../packages/device/src/touch/touch-fixtures";
import { previewSnapshot } from "../../renderer/src/strip/tiles/monitor/view-model";
import {
	MONITOR_METRICS,
	type MonitorCommand,
	MonitorReply,
	type SettingsView,
	STYLES,
} from "../../shared/monitor-contracts";
import { PROFILE_REQUEST } from "../../shared/profile-manager";
import { ClockLive, registerClock, registerClockScheme } from "../clock";
import { registerKnob } from "../knob";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { MediaLive, registerMedia } from "../media";
import { startMockDeviceBus } from "../mockDeviceBus";
import { ProfilesLive, registerProfiles } from "../profiles/profile-ipc";
import { clockProfile, stripFixtureEnvelope } from "../test/strip-fixtures";
import { createToneRecorder, registerVoiceSurface } from "../voice";
import { registerMonitor } from "./index";
import { nativeCollector } from "./native-collector";

assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1");
const artifacts = process.argv[2] ?? "";
assert(
	artifacts?.startsWith(
		"/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/monitor-panel",
	),
);
const base = mkdtempSync(join(artifacts, "native-"));
app.setPath("userData", base);
process.once("exit", () => rmSync(base, { recursive: true, force: true }));
registerClockScheme();
const wait = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (win: BrowserWindow, code: string): Promise<unknown> =>
	win.webContents.executeJavaScript(code);
async function until(win: BrowserWindow, code: string): Promise<void> {
	for (let i = 0; i < 150; i++) {
		if ((await evaluate(win, code)) === true) return;
		await wait(50);
	}
	await writeFile(
		join(artifacts, "failure.png"),
		(await win.webContents.capturePage()).toPNG(),
	);
	process.stderr.write(
		`${String(await evaluate(win, `document.body.innerText`))}\n`,
	);
	process.stderr.write(
		`${JSON.stringify(
			await evaluate(win, `window.quakeMonitor.request({_tag:"read"})`),
		)}\n`,
	);
	throw new Error(`Timed out: ${code}`);
}
async function request(
	win: BrowserWindow,
	command: MonitorCommand,
): Promise<MonitorReply> {
	const reply = await evaluate(
		win,
		`window.quakeMonitor.request(${JSON.stringify(command)})`,
	);
	assert(Schema.is(MonitorReply)(reply));
	return reply;
}
async function read(win: BrowserWindow): Promise<SettingsView> {
	const reply = await request(win, { _tag: "read" });
	assert.equal(reply._tag, "success");
	if (reply._tag !== "success") throw new Error("read failed");
	return reply.view;
}
const touchAt = (x: number, y: number): Uint8Array =>
	Uint8Array.from([
		0xa3,
		0,
		0,
		0x1a,
		1,
		1,
		(480 - y) & 255,
		(480 - y) >> 8,
		x & 255,
		x >> 8,
	]);
/** Encode the fixture with Chromium itself; no external encoder or asset. */
async function recordVideo(window: BrowserWindow, ms: number): Promise<Buffer> {
	const base64 = await evaluate(
		window,
		`(async () => {
		const canvas = Object.assign(document.createElement('canvas'), {width:320,height:80});
		const ctx = canvas.getContext('2d');
		const stream = canvas.captureStream(20);
		const recorder = new MediaRecorder(stream, {mimeType:'video/webm'});
		const chunks = [];
		recorder.ondataavailable = e => chunks.push(e.data);
		const done = new Promise(r => recorder.onstop = r);
		let frame = 0;
		const timer = setInterval(() => {
			ctx.fillStyle = 'hsl(' + frame++ * 7 % 360 + ',50%,25%)';
			ctx.fillRect(0,0,320,80);
		}, 50);
		recorder.start(100);
		await new Promise(r => setTimeout(r, ${ms}));
		recorder.stop(); await done; clearInterval(timer);
		stream.getTracks().forEach(track => track.stop());
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
	let dispose: (() => Promise<void>) | undefined;
	try {
		await mkdir(artifacts, { recursive: true });
		const options = {
			show: false,
			width: 1920,
			height: 480,
			useContentSize: true,
			enableLargerThanScreen: true,
			webPreferences: {
				preload: resolve("out/preload/index.mjs"),
				sandbox: false,
				contextIsolation: true,
				nodeIntegration: false,
				backgroundThrottling: false,
			},
		};
		const management = new BrowserWindow({
				...options,
				width: 1100,
				height: 1000,
			}),
			panel = new BrowserWindow(options);
		const thumbnail = new BrowserWindow(options);
		const renderer = pathToFileURL(resolve("out/renderer/index.html")).href;
		const voice = registerVoiceSurface({
			mock: true,
			tones: createToneRecorder(),
			serial: () => "desktop-preview",
			panel: () => panel,
			management: () => management,
			renderer,
		});
		const media = registerMedia(
			ManagedRuntime.make(MediaLive(join(base, "wallpaper-v1"))),
			() => management,
		);
		const clock = registerClock(
			ManagedRuntime.make(ClockLive(base)),
			() => management,
		);
		const lifecycleRuntime = ManagedRuntime.make(
			DeviceLifecycle.Default({
				mock: true,
				development: true,
				displays: () => [],
				watch: () => () => {},
				panel: () => {},
				bus: () => undefined,
				notify: () => {},
				prompts: {
					platform: process.platform,
					mock: true,
					displays: () => [],
					primaryId: () => 1,
					prompt: () => Effect.die("Monitor smoke must never prompt"),
					native: () =>
						Effect.die("Monitor smoke must never use native display APIs"),
					openSettings: () => Effect.void,
				},
			}),
		);
		const removeLifecycle = registerLifecycle(
			lifecycleRuntime,
			() => management,
			renderer,
		);
		const profile = {
			...clockProfile,
			id: "monitor",
			name: "SysView",
			pages: [
				{
					...clockProfile.pages[0],
					keys: clockProfile.pages[0].keys.map((key) => ({
						...key,
						childrenName: "systemMonitorPanel",
						config: {
							...key.config,
							type: "systemMonitorPanel",
							supportTouchEffect: false,
						},
					})),
				},
			] as const,
		};
		const profiles = registerProfiles(
			ManagedRuntime.make(
				ProfilesLive({
					read: async () => stripFixtureEnvelope(profile),
					write: async () => undefined,
				}),
			),
			renderer,
		);
		// Only the legacy profile fixture is served here; thumbnail-manager data is unavailable.
		ipcMain.handle(PROFILE_REQUEST, () => ({
			_tag: "rejected",
			reason: "monitor-smoke-fixture",
		}));
		let samples = 0;
		const fixture = previewSnapshot();
		const monitor = registerMonitor(
			base,
			() => management,
			() => panel,
			{
				collect: (id) =>
					Effect.sync(() => {
						samples++;
						return (
							fixture.samples.find((sample) => sample.id === id) ?? {
								state: "unsupported",
								values: {},
							}
						);
					}),
			},
			renderer,
		);
		const knob = registerKnob(
			() => panel,
			() => [panel, management],
		);
		const bus = startMockDeviceBus();
		const off = bus.on((event) => {
			if (
				!panel.isDestroyed() &&
				(event.kind === "touch" || event.kind === "status")
			)
				panel.webContents.send("quake:event", event);
		});
		dispose = async () => {
			off();
			bus.stop();
			await monitor.dispose();
			await voice.dispose();
			removeLifecycle();
			await lifecycleRuntime.dispose();
			for (const window of [management, panel, thumbnail])
				if (!window.isDestroyed()) window.destroy();
			await knob.dispose();
			await profiles.dispose();
			ipcMain.removeHandler(PROFILE_REQUEST);
			await clock.dispose();
			await media.dispose();
		};
		const errors: string[] = [];
		for (const window of [management, panel])
			window.webContents.on("console-message", (details) => {
				if (
					details.level === "error" &&
					!details.message.includes("No handler registered for 'knob:")
				)
					errors.push(details.message);
			});
		await management.loadFile(resolve("out/renderer/index.html"));
		await until(
			management,
			`!!document.querySelector('.nav-item[title="Screen"]')`,
		);
		await evaluate(
			management,
			`document.querySelector('.nav-item[title="Screen"]').click()`,
		);
		await until(
			management,
			`document.querySelector('.monitor-settings [data-monitor-style="glass"]')?.disabled === false`,
		);
		assert.equal(samples, 0, "PC preview must not collect");
		await thumbnail.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "profile-thumbnail" },
		});
		await evaluate(
			thumbnail,
			`window.monitorLeaks = 0; window.quakeMonitor.onSettings(() => window.monitorLeaks++); window.quakeMonitor.onMetrics(() => window.monitorLeaks++); void 0;`,
		);
		for (const command of [
			{ _tag: "read" },
			{ _tag: "watch", active: true },
		] as const)
			assert.equal(
				(await request(thumbnail, command))._tag,
				"failure",
				"profile thumbnails must have no monitor access",
			);
		await thumbnail.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await evaluate(
			thumbnail,
			`window.monitorLeaks = 0; window.quakeMonitor.onSettings(() => window.monitorLeaks++); window.quakeMonitor.onMetrics(() => window.monitorLeaks++); void 0;`,
		);
		assert.equal(
			(await request(thumbnail, { _tag: "watch", active: true }))._tag,
			"failure",
			"a spoofed panel URL must not grant subscription",
		);
		assert.equal(samples, 0, "unowned windows must not start collectors");
		assert.equal(
			(await request(management, { _tag: "watch", active: true }))._tag,
			"failure",
		);
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await until(
			panel,
			`document.querySelector('[data-testid="sys-monitor-value-cpu-load"]')?.textContent === '37%'`,
		);
		assert(samples > 0);
		let previous = "glass";
		for (const style of STYLES) {
			await evaluate(
				management,
				`document.querySelector('[data-monitor-style="${style}"]').click()`,
			);
			await until(
				management,
				`document.querySelector('.monitor-settings .oq-monitor')?.dataset.style === '${style}'`,
			);
			assert.equal(
				await evaluate(
					panel,
					`document.querySelector('.oq-monitor').dataset.style`,
				),
				previous,
				"draft leaked before Save",
			);
			await evaluate(
				management,
				`[...document.querySelectorAll('.monitor-save button')].find(b => b.textContent === 'Save').click()`,
			);
			await until(
				panel,
				`document.querySelector('.oq-monitor')?.dataset.style === '${style}'`,
			);
			await wait(200);
			const dimensions = await evaluate(
				panel,
				`(() => {const b=document.querySelector('.oq-monitor').getBoundingClientRect(); return [b.width,b.height,document.querySelectorAll('[data-testid^="sys-monitor-module-"]').length]})()`,
			);
			assert.deepEqual(dimensions, [1908, 462, 7]);
			panel.webContents.debugger.attach("1.3");
			await panel.webContents.debugger.sendCommand(
				"Emulation.setEmulatedMedia",
				{
					features: [{ name: "prefers-contrast", value: "more" }],
				},
			);
			assert.equal(
				await evaluate(
					panel,
					`getComputedStyle(document.querySelector('.monitor-card')).backdropFilter`,
				),
				"none",
				"contrast must remove transparent blur in every style",
			);
			await panel.webContents.debugger.sendCommand(
				"Emulation.setEmulatedMedia",
				{ features: [] },
			);
			panel.webContents.debugger.detach();
			const image = await panel.webContents.capturePage();
			await writeFile(
				join(artifacts, `panel-${style}-1920x480.png`),
				image.resize({ width: 1920, height: 480 }).toPNG(),
			);
			previous = style;
		}
		assert.equal(
			await evaluate(thumbnail, "window.monitorLeaks"),
			0,
			"thumbnails must receive neither metrics nor settings broadcasts",
		);
		assert.equal(
			(await request(panel, { _tag: "read", styleId: "cyber" }))._tag,
			"failure",
			"only management may read another style's background",
		);
		assert.equal(
			(
				await request(panel, {
					_tag: "save",
					revision: 5,
					settings: (await read(panel)).settings,
				})
			)._tag,
			"failure",
			"panel must not mutate settings",
		);
		// Native mocked touch through parser/tracker/bus/preload and the mounted registry.
		const before = await read(management);
		assert.equal(
			(
				await request(management, {
					_tag: "save",
					revision: before.revision,
					settings: { ...before.settings, styleId: "glass", hz: 0.2 },
				})
			)._tag,
			"success",
		);
		await until(
			panel,
			`document.querySelector('.oq-monitor')?.dataset.style === 'glass'`,
		);
		await wait(100);
		panel.webContents.send(MONITOR_METRICS, {
			...fixture,
			samples: fixture.samples.map((s) =>
				s.id === "disk"
					? {
							...s,
							values: {
								disks: Array.from({ length: 10 }, (_, i) => ({
									name: `Disk ${i}`,
									size: 1024 ** 3,
									usedPercent: i * 10,
								})),
							},
						}
					: s,
			),
		});
		await until(
			panel,
			`document.querySelector('.monitor-disk-list')?.scrollHeight > document.querySelector('.monitor-disk-list')?.clientHeight`,
		);
		await evaluate(
			panel,
			`window.monitorKeyEvents = 0; document.querySelector('.strip-screen').addEventListener('quake-strip-key', () => window.monitorKeyEvents++)`,
		);
		const bounds = await evaluate(
			panel,
			`(() => { const r=document.querySelector('.monitor-disk-list').getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height-20)}; })()`,
		);
		assert(
			typeof bounds === "object" &&
				bounds !== null &&
				"x" in bounds &&
				"y" in bounds &&
				typeof bounds.x === "number" &&
				typeof bounds.y === "number",
		);
		bus.emitTouchReport(touchAt(bounds.x, bounds.y));
		await wait(25);
		bus.emitTouchReport(touchAt(bounds.x, bounds.y - 40));
		await wait(25);
		bus.emitTouchReport(touchAt(bounds.x, bounds.y - 80));
		await wait(25);
		bus.emitTouchReport(SYNTHETIC_TOUCH_EMPTY);
		await wait(250);
		assert.equal(
			await evaluate(
				panel,
				`document.querySelector('.monitor-disk-list').scrollTop > 0 && window.monitorKeyEvents === 0`,
			),
			true,
			"native disk drag must scroll without key actions",
		);
		// Main-selected media is staged, remains a draft, and falls back if removed.
		const picture = join(base, "selected.png");
		await writeFile(
			picture,
			nativeImage
				.createFromBitmap(Buffer.from([255, 120, 50, 255]), {
					width: 1,
					height: 1,
				})
				.toPNG(),
		);
		dialog.showOpenDialog = async () => ({
			canceled: false,
			filePaths: [picture],
		});
		const staged = await request(management, {
			_tag: "chooseMedia",
			styleId: "glass",
		});
		assert.equal(staged._tag, "media");
		if (staged._tag !== "media") throw new Error("stage failed");
		const saved = await read(management);
		assert.equal(saved.settings.media.glass, undefined);
		assert.equal(
			(
				await request(management, {
					_tag: "save",
					revision: saved.revision,
					settings: {
						...saved.settings,
						background: "custom",
						media: { glass: staged.slot },
					},
				})
			)._tag,
			"success",
		);
		await until(
			panel,
			`document.querySelector('.monitor-background')?.complete === true`,
		);
		await rm(join(base, "monitor-v1/assets", staged.slot.id));
		const missing = await read(management);
		assert.equal(missing.media.glass?.available, false);
		assert.equal(
			(
				await request(management, {
					_tag: "save",
					revision: missing.revision,
					settings: missing.settings,
				})
			)._tag,
			"success",
		);
		await until(panel, `!!document.querySelector('.monitor-background-error')`);
		const windowsBeforeProbe = BrowserWindow.getAllWindows().length;
		const video = join(base, "loop.webm");
		await writeFile(video, await recordVideo(management, 2500));
		dialog.showOpenDialog = async () => ({
			canceled: false,
			filePaths: [video],
		});
		const stagedVideo = await request(management, {
			_tag: "chooseMedia",
			styleId: "glass",
		});
		assert.equal(stagedVideo._tag, "media");
		assert.equal(BrowserWindow.getAllWindows().length, windowsBeforeProbe);
		if (stagedVideo._tag !== "media") throw new Error("video stage failed");
		const beforeVideo = await read(management);
		await request(management, {
			_tag: "save",
			revision: beforeVideo.revision,
			settings: { ...beforeVideo.settings, media: { glass: stagedVideo.slot } },
		});
		await until(
			panel,
			`(() => {const v=document.querySelector('video.monitor-background'); return !!v && v.readyState >= 2 && !v.paused && v.muted && v.loop;})()`,
		);
		// Persist all five slots, then preview a different saved style without Save.
		const oneStyle = await read(management);
		const savedStyles = { ...oneStyle.settings.media };
		for (const style of STYLES) savedStyles[style] = stagedVideo.slot;
		const multiStyle = await request(management, {
			_tag: "save",
			revision: oneStyle.revision,
			settings: { ...oneStyle.settings, media: savedStyles },
		});
		assert(multiStyle._tag === "success");
		assert.deepEqual(Object.keys(multiStyle.view.media), ["glass"]);
		const otherStyle = await request(management, {
			_tag: "read",
			styleId: "cyber",
		});
		assert(otherStyle._tag === "success");
		assert.deepEqual(Object.keys(otherStyle.view.media), ["cyber"]);
		assert.equal(otherStyle.view.settings.styleId, "glass");
		await evaluate(
			management,
			`document.querySelector('[data-monitor-style="cyber"]').click()`,
		);
		await until(
			management,
			`(() => {const p=document.querySelector('.monitor-settings .oq-monitor[data-style="cyber"]'); const v=p?.querySelector('video.monitor-background'); return !!v && v.readyState >= 2;})()`,
		);
		assert.equal(
			await evaluate(
				panel,
				`document.querySelector('.oq-monitor').dataset.style`,
			),
			"glass",
		);
		await evaluate(
			management,
			`[...document.querySelectorAll('.monitor-save button')].find(b => b.textContent === 'Revert').click()`,
		);
		await until(
			management,
			`document.querySelector('.monitor-settings .oq-monitor')?.dataset.style === 'glass'`,
		);
		const short = join(base, "short.webm");
		await writeFile(short, await recordVideo(management, 500));
		dialog.showOpenDialog = async () => ({
			canceled: false,
			filePaths: [short],
		});
		const refused = await request(management, {
			_tag: "chooseMedia",
			styleId: "glass",
		});
		assert.equal(refused._tag, "failure");
		if (refused._tag === "failure") {
			assert.equal(refused.code, "QUAKE.MONITOR.VIDEO_TOO_SHORT");
			assert.equal(
				refused.message,
				"Video duration too short, should be longer than 2 seconds.",
			);
		}
		assert.equal(BrowserWindow.getAllWindows().length, windowsBeforeProbe);
		dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
		assert.equal(
			(await request(management, { _tag: "chooseMedia", styleId: "glass" }))
				._tag,
			"cancelled",
		);
		assert.equal(
			(await read(management)).settings.media.glass?.id,
			stagedVideo.slot.id,
		);
		// Reduced motion also removes the Cyberpunk scanline.
		panel.webContents.debugger.attach("1.3");
		await panel.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
			features: [{ name: "prefers-reduced-motion", value: "reduce" }],
		});
		const current = await read(management);
		await request(management, {
			_tag: "save",
			revision: current.revision,
			settings: {
				...current.settings,
				background: "none",
				styleId: "cyber",
				enabled: false,
			},
		});
		await until(
			panel,
			`document.querySelector('.oq-monitor')?.dataset.background === 'none'`,
		);
		assert.equal(
			await evaluate(
				panel,
				`getComputedStyle(document.querySelector(".monitor-scanline")).animationName`,
			),
			"none",
		);
		panel.webContents.debugger.detach();
		const count = samples;
		await wait(350);
		assert.equal(samples, count, "disable must stop sampling");
		const disabled = await read(management);
		await request(management, {
			_tag: "save",
			revision: disabled.revision,
			settings: { ...disabled.settings, enabled: true, hz: 10 },
		});
		await wait(200);
		assert(samples > count, "enable must resume sampling");
		panel.destroy();
		await wait(150);
		const afterClose = samples;
		await wait(350);
		assert.equal(
			samples,
			afterClose,
			"last live panel close must stop sampling",
		);
		const native = nativeCollector();
		for (const id of [
			"cpu",
			"memory",
			"disk",
			"process",
			"network",
			"power",
			"gpu",
		] as const) {
			const result = await Effect.runPromise(native.collect(id));
			process.stdout.write(`Native ${id}: ${result.state}\n`);
		}
		assert.deepEqual(errors, []);
		process.stdout.write(
			"Monitor native smoke PASS: five styles at 1920x480, draft/Save, fixture isolation, main-owned permissions, thumbnail/spoof rejection with no broadcasts, lazy multi-style saved video previews, native disk drag, image fallback, video playback/duration/cancel, disable and window-close cleanup. No device opened.\n",
		);
	} finally {
		await dispose?.();
		app.quit();
	}
}
smoke().catch((cause) => {
	process.stderr.write(`${String(cause)}\n`);
	app.exit(1);
});
