/** Native Electron proof. Hidden windows, mock touch, no HID imports or opens. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow, dialog, ipcMain, nativeImage } from "electron";
import { KeyEditing } from "../../../../../packages/device/src/profiles/key-editing-service";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog";
import {
	Profile,
	ProfileDraft,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import { SYNTHETIC_TOUCH_EMPTY } from "../../../../../packages/device/src/touch/touch-fixtures";
import { withMonitorKeySettings } from "../../renderer/src/strip/tiles/monitor/key-settings";
import { previewSnapshot } from "../../renderer/src/strip/tiles/monitor/view-model";
import { KEY_PREVIEW, KEY_REQUEST, KeyRequest } from "../../shared/key-library";
import {
	MONITOR_METRICS,
	type MonitorCommand,
	MonitorReply,
	MonitorSnapshot,
	type SettingsView,
	STYLES,
} from "../../shared/monitor-contracts";
import { PROFILE_REQUEST } from "../../shared/profile-manager";
import { ClockLive, registerClock, registerClockScheme } from "../clock";
import { registerKnob } from "../knob";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { registerManagementAppearance } from "../management/appearance";
import { ManagementProfileContractsLive } from "../management/profile-contracts";
import { MediaLive, registerMedia } from "../media";
import { startMockDeviceBus } from "../mockDeviceBus";
import { registerProfiles } from "../profiles/profile-ipc";
import { stripFixtureEnvelope } from "../test/strip-fixtures";
import { createToneRecorder, registerVoiceSurface } from "../voice";
import { registerMonitor } from "./index";
import { nativeCollector } from "./native-collector";
import { activeMonitorKey } from "./panel-media";

assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1");
const artifactsArgument = process.argv[2] ?? "";
assert(artifactsArgument.trim(), "pass a non-empty artifacts directory");
const artifacts = resolve(artifactsArgument);
mkdirSync(artifacts, { recursive: true });
const base = mkdtempSync(join(artifacts, "native-"));
app.setPath("userData", base);
process.once("exit", () => rmSync(base, { recursive: true, force: true }));
registerClockScheme();
const wait = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (win: BrowserWindow, code: string): Promise<unknown> =>
	win.webContents.executeJavaScript(code).catch((cause: unknown) => {
		throw new Error(`Renderer script failed: ${code.slice(0, 500)}`, { cause });
	});
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
		const removeAppearance = registerManagementAppearance(
			() => management,
			base,
			renderer,
		);
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
		const builtin = builtinProfiles("darwin").find((p) => p.id === "1-3");
		assert(builtin);
		const profile = {
			...Schema.encodeSync(Profile)(builtin),
			id: "monitor",
			name: "SysView",
		};
		const initialProfiles = stripFixtureEnvelope(profile);
		let storedProfiles: typeof ProfileEnvelope.Encoded = {
			...initialProfiles,
			profiles: [
				initialProfiles.profiles[0],
				{
					...initialProfiles.profiles[0],
					id: "monitor-second",
					name: "Second monitor",
				},
			],
		};
		const repository = ProfileRepository.DefaultWithoutDependencies.pipe(
			Layer.provide(ManagementProfileContractsLive),
			Layer.provide(
				profileStorageLayer({
					read: async () => storedProfiles,
					write: async (value) => {
						storedProfiles = value;
					},
				}),
			),
		);
		const profileRuntime = ManagedRuntime.make(
			KeyEditing.DefaultWithoutDependencies.pipe(
				Layer.provideMerge(
					ProfileService.DefaultWithoutDependencies.pipe(
						Layer.provideMerge(repository),
					),
				),
			),
		);

		const profiles = registerProfiles(profileRuntime, renderer);
		const commitPresentation = async (settings: SettingsView["settings"]) => {
			const loaded = await profileRuntime.runPromise(
				ProfileService.getProfile("monitor"),
			);
			const first = loaded.pages[0].keys[0];
			assert(first);
			const edited = withMonitorKeySettings(first, settings);
			const raw = Schema.encodeSync(ProfileDraft)(loaded);
			await profileRuntime.runPromise(
				ProfileService.saveProfile({
					expectedRevision: loaded.revision,
					profile: {
						...raw,
						pages: raw.pages.map((pg, i) =>
							i ? pg : { ...pg, keys: [Schema.encodeSync(ProfileKey)(edited)] },
						),
					},
				}),
			);
		};
		ipcMain.handle(KEY_REQUEST, async (_event, input: unknown) => {
			const c = Schema.decodeUnknownSync(KeyRequest)(input);
			const result = await profileRuntime.runPromise(
				Effect.gen(function* () {
					if (c.type === "preview")
						yield* KeyEditing.preview(c.target, c.key, c.geometry);
					else if (c.type === "save") yield* KeyEditing.save(c.token);
					else if (c.type === "revert") yield* KeyEditing.revert(c.token);
					else if (c.type === "select")
						yield* ProfileService.selectProfile({
							deviceId: c.deviceId,
							profileId: c.profileId,
							pageId: c.pageId,
						});
					const envelope = yield* KeyEditing.read();
					return Schema.encodeSync(ProfileEnvelope)(envelope);
				}),
			);
			if (c.type === "preview" || c.type === "revert")
				management.webContents.send(KEY_PREVIEW, { envelope: result });
			return { _tag: "success", envelope: result };
		});
		// Only the legacy profile fixture is served here; thumbnail-manager data is unavailable.
		ipcMain.handle(PROFILE_REQUEST, () => ({
			_tag: "rejected",
			reason: "monitor-smoke-fixture",
		}));
		let samples = 0;
		let failNetwork = true;
		let fixture = previewSnapshot();
		const monitor = registerMonitor(
			base,
			() => management,
			() => panel,
			{
				collect: (id) =>
					Effect.sync(() => {
						samples++;
						if (id === "network" && failNetwork)
							return { state: "error" as const, values: {} };
						return (
							fixture.samples.find((sample) => sample.id === id) ?? {
								state: "unsupported",
								values: {},
							}
						);
					}),
			},
			renderer,
			undefined,
			async (keyCode) => {
				const { envelope } = await profileRuntime.runPromise(
					ProfileRepository.load(),
				);
				return activeMonitorKey(envelope, "desktop-preview", keyCode);
			},
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
			removeAppearance();
			off();
			bus.stop();
			await monitor.dispose();
			await voice.dispose();
			removeLifecycle();
			await lifecycleRuntime.dispose();
			for (const window of [management, panel, thumbnail])
				if (!window.isDestroyed()) window.destroy();
			await knob.dispose();
			ipcMain.removeHandler(KEY_REQUEST);
			await profiles.dispose();
			await profileRuntime.dispose();
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
			`document.querySelector('.monitor-hz')?.disabled === false`,
		);
		await until(
			management,
			`document.querySelector('[data-testid="monitor-live-cpu"]')?.dataset.state === 'live'`,
		);
		assert(samples > 0, "trusted Live status must start collection");
		await thumbnail.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "profile-thumbnail" },
		});
		await evaluate(
			thumbnail,
			`window.monitorLeaks = 0; window.quakeMonitor.onSettings(() => window.monitorLeaks++); window.quakeMonitor.onMetrics(() => window.monitorLeaks++); window.quakeMonitor.onState(() => window.monitorLeaks++); void 0;`,
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
			`window.monitorLeaks = 0; window.quakeMonitor.onSettings(() => window.monitorLeaks++); window.quakeMonitor.onMetrics(() => window.monitorLeaks++); window.quakeMonitor.onState(() => window.monitorLeaks++); void 0;`,
		);
		assert.equal(
			(await request(thumbnail, { _tag: "watch", active: true }))._tag,
			"failure",
			"a spoofed panel URL must not grant subscription",
		);

		assert.equal(
			(await request(management, { _tag: "watch", active: true }))._tag,
			"success",
		);
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await until(
			panel,
			`document.querySelector('[data-testid="sys-monitor-value-cpu-load"]')?.textContent === '37%'`,
		);
		assert(samples > 0);
		for (const win of [thumbnail, panel])
			assert.equal(
				await evaluate(
					win,
					`window.quakeMonitor.snapshot().then(() => false, () => true)`,
				),
				true,
				"only management can read full foreground state",
			);
		await evaluate(
			panel,
			`window.fullStateLeaks = 0; window.monitorFrames = []; window.quakeMonitor.onState(() => window.fullStateLeaks++); window.quakeMonitor.onMetrics(v => {window.monitorFrames.push(v); window.monitorFrames = window.monitorFrames.slice(-8);}); void 0;`,
		);
		await evaluate(
			management,
			`window.monitorFrames = []; window.quakeMonitor.onState(v => {window.monitorFrames.push(v.metrics); window.monitorFrames = window.monitorFrames.slice(-8);}); void 0;`,
		);
		await until(
			management,
			`document.querySelector('[data-testid="monitor-live-network"]')?.dataset.state === 'error'`,
		);
		await until(panel, `window.monitorFrames.length > 0`);
		const panelFrames = Schema.decodeUnknownSync(Schema.Array(MonitorSnapshot))(
			await evaluate(panel, `window.monitorFrames`),
		);
		const managementFrames = Schema.decodeUnknownSync(
			Schema.Array(MonitorSnapshot),
		)(await evaluate(management, `window.monitorFrames`));
		const common = panelFrames.find((frame) =>
			managementFrames.some((other) => other.sampledAt === frame.sampledAt),
		);
		assert(common, "actual management and panel must receive a shared sample");
		assert.deepEqual(
			common,
			managementFrames.find((frame) => frame.sampledAt === common.sampledAt),
		);
		assert.equal(
			common.samples.find((sample: { id: string }) => sample.id === "network")
				?.state,
			"error",
		);
		assert.equal(
			common.samples.find((sample: { id: string }) => sample.id === "cpu")
				?.state,
			"available",
		);
		assert.equal(await evaluate(panel, `window.fullStateLeaks`), 0);
		failNetwork = false;
		await until(
			management,
			`document.querySelector('[data-testid="monitor-live-network"]')?.dataset.state === 'live'`,
		);

		// Exercise the saved overlay through real controls, and compare both actual consumers.
		const saveControls = async (): Promise<void> => {
			const revision = (await read(management)).revision;
			await until(
				management,
				`![...document.querySelectorAll('.monitor-save button')].find(b => b.textContent === 'Save').disabled`,
			);
			await evaluate(
				management,
				`[...document.querySelectorAll('.monitor-save button')].find(b => b.textContent === 'Save').click()`,
			);
			await until(
				management,
				`window.quakeMonitor.request({_tag:'read'}).then(r => r._tag === 'success' && r.view.revision > ${revision})`,
			);
			await until(
				management,
				`[...document.querySelectorAll('.monitor-save button')].find(b => b.textContent === 'Save').disabled`,
			);
		};
		const toggleLabel = async (label: string): Promise<void> => {
			await evaluate(
				management,
				`document.getElementById([...document.querySelectorAll('.monitor-settings label')].find(l => l.textContent === ${JSON.stringify(label)}).htmlFor).click()`,
			);
		};
		const capture = async (name: string): Promise<void> => {
			for (const width of [1180, 820, 390]) {
				management.setContentSize(width, 625);
				await wait(80);
				assert.equal(management.getContentSize()[0], width);
				for (const [section, title] of [
					["preview", "System monitor panel"],
					["live", "Live status"],
					["controls", "App monitor"],
				]) {
					await evaluate(
						management,
						`[...document.querySelectorAll('.monitor-settings .group')].find(s => s.querySelector('h2')?.textContent === ${JSON.stringify(title)}).scrollIntoView({block:'start'})`,
					);
					await wait(50);
					const overflow = await evaluate(
						management,
						`Array.from(document.querySelectorAll('*')).filter(e=>e.clientWidth>0 && e.scrollWidth>e.clientWidth+1 && ['auto','scroll'].includes(getComputedStyle(e).overflowX)).map(e=>({tag:e.tagName,cls:e.className,width:e.clientWidth,scroll:e.scrollWidth}))`,
					);
					await writeFile(
						join(artifacts, `${name}-${section}-${width}-geometry.json`),
						JSON.stringify(overflow),
					);
					await writeFile(
						join(artifacts, `${name}-${section}-${width}.png`),
						(await management.webContents.capturePage()).toPNG(),
					);
					assert.deepEqual(
						overflow,
						[],
						`${name}/${section}/${width} overflows`,
					);
				}
			}
			management.setContentSize(1100, 625);
		};
		await until(
			management,
			`document.querySelector('[data-testid="monitor-live-bluetooth"]')?.dataset.state === 'unsupported'`,
		);
		await capture("normal");
		await toggleLabel("Use monitoring override");
		await saveControls();
		await until(
			management,
			`document.querySelector('[data-testid="monitor-live-monitoring"]')?.textContent === 'Override · 1 Hz'`,
		);
		await until(
			panel,
			`[...document.querySelectorAll('.monitor-state')].filter(n => n.textContent === 'Off').length === 6`,
		);
		await until(
			management,
			`document.querySelector('[data-testid="monitor-live-memory"]')?.dataset.state === 'off'`,
		);
		await capture("override");
		// A normal-rate edit is durable but cannot change the active overlay.
		management.webContents.debugger.attach("1.3");
		await evaluate(
			management,
			`(() => {const i=document.querySelector('input[aria-label="Samples per second"]'); i.focus(); i.select();})()`,
		);
		await management.webContents.debugger.sendCommand("Input.insertText", {
			text: "2",
		});
		management.webContents.debugger.detach();
		await saveControls();
		assert.equal((await read(management)).settings.hz, 2);
		assert.equal(
			await evaluate(
				management,
				`document.querySelector('[data-testid="monitor-live-monitoring"]').textContent`,
			),
			"Override · 1 Hz",
		);
		await toggleLabel("Use monitoring override");
		await saveControls();
		await until(
			management,
			`document.querySelector('[data-testid="monitor-live-monitoring"]')?.textContent === 'Running · 2 Hz'`,
		);
		await until(
			panel,
			`document.querySelector('[data-testid="sys-monitor-value-mem-used-gb"]')?.textContent !== '--'`,
		);
		await toggleLabel("Track foreground app");
		await saveControls();
		await until(
			management,
			`document.querySelector('[data-testid="monitor-live-foreground"]')?.dataset.state === 'waiting'`,
		);
		await capture("foreground-mock");
		await toggleLabel("Enable monitoring");
		await saveControls();
		await until(
			management,
			`document.querySelector('[data-testid="monitor-live-foreground"]')?.dataset.state === 'off'`,
		);
		const stoppedCount = samples;
		await wait(600);
		assert.equal(samples, stoppedCount, "master-off must stop all metric work");
		await capture("disabled");
		await toggleLabel("Enable monitoring");
		await toggleLabel("Track foreground app");
		await saveControls();
		await until(
			management,
			`document.querySelector('[data-testid="monitor-live-cpu"]')?.dataset.state === 'live'`,
		);
		// Mounted key editor uses the production draft and repository validation path.
		await evaluate(
			management,
			`document.querySelector('.nav-item[title="Keys"]').click()`,
		);
		await until(management, `!!document.querySelector('#keys-profile')`);
		const selectValue = async (selector: string, value: string) => {
			await evaluate(
				management,
				`(() => {const e=document.querySelector(${JSON.stringify(selector)}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('change',{bubbles:true}));})()`,
			);
		};
		const chooseKey = async () => {
			await evaluate(
				management,
				`[...document.querySelectorAll('.keys-cells button')].find(b=>b.textContent==='1,1').click()`,
			);
			await until(
				management,
				`!!document.querySelector('select[aria-label="Panel style"]')`,
			);
		};
		await chooseKey();
		await selectValue('select[aria-label="Panel style"]', "cyber");
		await selectValue('select[aria-label="Temperature Unit"]', "fahrenheit");
		await until(
			management,
			`document.querySelector('fieldset[aria-label="Monitor settings"] .oq-monitor')?.dataset.style==='cyber'`,
		);
		assert.equal(
			(await profileRuntime.runPromise(ProfileService.getProfile("monitor")))
				.revision,
			0,
			"draft cannot write storage",
		);
		await evaluate(
			management,
			`[...document.querySelectorAll('.key-editor button')].filter(b=>b.textContent==='Cancel').at(-1).click()`,
		);
		await until(
			management,
			`!document.querySelector('select[aria-label="Panel style"]')`,
		);
		await chooseKey();
		assert.equal(
			await evaluate(
				management,
				`document.querySelector('select[aria-label="Panel style"]').value`,
			),
			"glass",
		);
		await selectValue('select[aria-label="Panel style"]', "cyber");
		await selectValue('select[aria-label="Temperature Unit"]', "fahrenheit");
		await evaluate(
			management,
			`[...document.querySelectorAll('.key-editor button')].filter(b=>b.textContent==='Save').at(-1).click()`,
		);
		await until(
			management,
			`document.body.innerText.includes('Saved successfully')`,
		);
		await until(
			panel,
			`document.querySelector('.oq-monitor')?.dataset.style==='cyber'`,
		);
		assert.equal(
			(
				await profileRuntime.runPromise(
					ProfileService.getProfile("monitor-second"),
				)
			).revision,
			0,
			"saving one profile leaves the other unchanged",
		);
		for (const locale of ["en", "de"]) {
			await selectValue("#keys-language", locale);
			await until(
				management,
				`!!document.querySelector('fieldset[aria-label="${locale === "de" ? "Monitor-Einstellungen" : "Monitor settings"}"]')`,
			);
			await evaluate(
				management,
				`document.querySelector('fieldset[aria-label="${locale === "de" ? "Monitor-Einstellungen" : "Monitor settings"}"] select').scrollIntoView({block:'center'})`,
			);
			await writeFile(
				join(artifacts, `key-settings-${locale}.png`),
				(await management.webContents.capturePage()).toPNG(),
			);
		}
		await selectValue("#keys-language", "en");
		await evaluate(
			management,
			`document.querySelector('.nav-item[title="Screen"]').click()`,
		);
		await until(management, `!!document.querySelector('.monitor-hz')`);
		fixture = {
			...fixture,
			samples: fixture.samples.map((s) =>
				s.id === "gpu"
					? {
							...s,
							values: {
								...s.values,
								model:
									"Long graphics device model with an external adapter and an extended manufacturer identifier",
							},
						}
					: s,
			),
		};
		await until(
			panel,
			`document.querySelector('[data-testid="sys-monitor-value-gpu-model"]')?.textContent.includes('Long graphics device')`,
		);
		for (const style of STYLES) {
			await commitPresentation({
				...(await read(management)).settings,
				styleId: style,
			});
			await until(
				panel,
				`document.querySelector('.oq-monitor')?.dataset.style === '${style}'`,
			);
			await wait(100);
			const geometry = await evaluate(
				panel,
				`(() => {const p=document.querySelector('.oq-monitor'); const r=p.getBoundingClientRect(); return [...p.querySelectorAll('[data-testid^="sys-monitor-module-"]')].map(e=>{const b=e.getBoundingClientRect(); return {id:e.dataset.testid,bounds:[b.left,b.top,b.right,b.bottom],panel:[r.left,r.top,r.right,r.bottom],visible:b.width>0&&b.height>0,inside:b.left>=r.left-1&&b.right<=r.right+1&&b.top>=r.top-1&&b.bottom<=r.bottom+1};});})()`,
			);
			assert(Array.isArray(geometry));
			assert.equal(geometry.length, 7);
			assert(
				geometry.every((g) => g.visible && g.inside),
				`${style} module bounds: ${JSON.stringify(geometry)}`,
			);
			const readoutBounds = await evaluate(
				panel,
				`(() => {const p=document.querySelector('.oq-monitor'); return [...p.querySelectorAll('.monitor-value')].filter(e=>e.getBoundingClientRect().width).map(e=>{const b=e.getBoundingClientRect(),c=e.closest('.monitor-card')?.getBoundingClientRect();return {value:e.textContent,inside:!c||(b.left>=c.left-1&&b.right<=c.right+1&&b.top>=c.top-1&&b.bottom<=c.bottom+1)};});})()`,
			);
			assert(
				Array.isArray(readoutBounds) && readoutBounds.every((v) => v.inside),
				`${style} values clipped: ${JSON.stringify(readoutBounds)}`,
			);
			panel.webContents.debugger.attach("1.3");
			for (const feature of [
				[],
				[{ name: "prefers-reduced-motion", value: "reduce" }],
				[{ name: "prefers-reduced-transparency", value: "reduce" }],
				[{ name: "prefers-contrast", value: "more" }],
			]) {
				await panel.webContents.debugger.sendCommand(
					"Emulation.setEmulatedMedia",
					{ features: feature },
				);
				const result = await evaluate(
					panel,
					`(() => { const p=document.querySelector('.oq-monitor'); const r=p.getBoundingClientRect(); return { width:r.width,height:r.height,modules:p.querySelectorAll('[data-testid^="sys-monitor-module-"]').length,invalid:[...p.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return s.backdropFilter!=='none'||s.animationName!=='none'||s.backgroundImage.includes('gradient')}).length,surface:getComputedStyle(p.querySelector('.monitor-card')).backgroundColor,ticker:p.querySelector('.monitor-ticker')?.offsetHeight }; })()`,
				);
				assert(result && typeof result === "object" && "invalid" in result);
				assert.equal(
					result.invalid,
					0,
					"all styles obey flat design and a11y policies",
				);
				assert("modules" in result);
				assert.equal(result.modules, 7);
				assert("surface" in result);
				assert.equal(result.surface, "rgb(21, 23, 26)");
				if (style === "cyber") {
					assert("ticker" in result);
					assert.equal(result.ticker, 40);
				}
			}
			await panel.webContents.debugger.sendCommand(
				"Emulation.setEmulatedMedia",
				{ features: [] },
			);
			panel.webContents.debugger.detach();
			await writeFile(
				join(artifacts, `panel-${style}-1920x480.png`),
				(await panel.webContents.capturePage())
					.resize({ width: 1920, height: 480 })
					.toPNG(),
			);
		}

		fixture = previewSnapshot();

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
		await commitPresentation({
			...(await read(management)).settings,
			styleId: "glass",
		});
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
		await commitPresentation({
			...(await read(management)).settings,
			styleId: "glass",
		});
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
		await panel.reload();
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
		await commitPresentation((await read(management)).settings);
		await until(
			panel,
			`(() => {const v=document.querySelector('video.monitor-background'); return !!v && v.readyState >= 2 && !v.paused && v.muted && v.loop;})()`,
		);
		// Hiding releases the element and source; showing resumes with a fresh element.
		await evaluate(
			panel,
			`window.oldMonitorVideo=document.querySelector('video.monitor-background'); Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange'))`,
		);
		await until(panel, `!document.querySelector('video.monitor-background')`);
		assert.equal(
			await evaluate(
				panel,
				`window.oldMonitorVideo.paused && !window.oldMonitorVideo.hasAttribute('src')`,
			),
			true,
		);
		await evaluate(
			panel,
			`Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange'))`,
		);
		await until(
			panel,
			`!!document.querySelector('video.monitor-background') && document.querySelector('video.monitor-background')!==window.oldMonitorVideo`,
		);
		await evaluate(
			panel,
			`document.querySelector('video.monitor-background').dispatchEvent(new Event('error'))`,
		);
		await until(
			panel,
			`!!document.querySelector('.monitor-background-error') && !document.querySelector('video.monitor-background')`,
		);
		// Accelerate only the declared startup deadline, before playback can start.
		await evaluate(
			panel,
			`window.realMonitorTimeout=window.setTimeout; window.monitorTimeouts=[]; window.setTimeout=(fn,ms,...args)=>{if(ms===5000){window.monitorTimeouts.push(ms);return window.realMonitorTimeout(fn,0,...args)}return window.realMonitorTimeout(fn,ms,...args)};void 0`,
		);
		await commitPresentation({
			...(await read(management)).settings,
			styleId: "anime",
			media: { anime: stagedVideo.slot },
		});
		await until(
			panel,
			`!!document.querySelector('.monitor-background-error') && window.monitorTimeouts.includes(5000)`,
		);
		await evaluate(panel, `window.setTimeout=window.realMonitorTimeout;void 0`);
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
		await commitPresentation({ ...multiStyle.view.settings, styleId: "cyber" });
		await until(
			panel,
			`document.querySelector('.oq-monitor')?.dataset.style === 'cyber'`,
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
		await commitPresentation({
			...(await read(management)).settings,
			background: "none",
			styleId: "cyber",
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
		const metricProfile = await profileRuntime.runPromise(
			ProfileService.getProfile("monitor-second"),
		);
		const draft = Schema.encodeSync(ProfileDraft)(metricProfile);
		const baseKey = draft.pages[0].keys[0];
		assert(baseKey);
		const types = [
			"cpuInfo",
			"gpuInfo",
			"memInfo",
			"diskInfo",
			"processInfo",
			"networkInfo",
			"powerInfo",
			"bluetoothInfo",
		];
		await profileRuntime.runPromise(
			ProfileService.saveProfile({
				expectedRevision: metricProfile.revision,
				profile: {
					...draft,
					pages: [
						{
							...draft.pages[0],
							keys: types.map((type, i) => ({
								...baseKey,
								keyCode: `1,${i + 1}`,
								childrenName: type,
								config: {
									...baseKey.config,
									type,
									size: [1, 1],
									temperatureUnit: "fahrenheit",
									actions: [],
								},
							})),
						},
					],
				},
			}),
		);
		await profileRuntime.runPromise(
			ProfileService.selectProfile({
				deviceId: "desktop-preview",
				profileId: "monitor-second",
				pageId: metricProfile.pages[0].id,
			}),
		);
		await until(
			panel,
			`document.querySelectorAll('.monitor-metric-tile').length===8 && document.querySelector('[data-metric="cpu"] strong')?.textContent==='37%'`,
		);
		assert.equal(
			await evaluate(
				panel,
				`document.querySelector('[data-metric="gpu"]').textContent.includes('111 °F')`,
			),
			true,
		);
		assert.equal(
			await evaluate(
				panel,
				`document.querySelector('[data-metric="bluetooth"] strong').textContent`,
			),
			"--",
		);
		await writeFile(
			join(artifacts, "individual-metrics-1920x480.png"),
			(await panel.webContents.capturePage()).toPNG(),
		);
		panel.destroy();
		await request(management, { _tag: "watch", active: false });
		await wait(150);
		const afterClose = samples;
		await wait(350);
		assert.equal(
			samples,
			afterClose,
			"last live consumer detaching must stop sampling",
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
			"bluetooth",
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
	process.stderr.write(
		`${cause instanceof Error ? cause.stack : String(cause)}\n`,
	);
	app.exit(1);
});
