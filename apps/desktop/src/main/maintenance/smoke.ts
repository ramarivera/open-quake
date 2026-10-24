import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HardwareControls } from "@open-quake/device";
import { Effect, Exit, ManagedRuntime, Option, Schema, Scope } from "effect";
import {
	app,
	BaseWindow,
	BrowserWindow,
	dialog,
	type MessageBoxOptions,
	nativeImage,
	shell,
} from "electron";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import { Profile } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { syntheticUf2 } from "../../../../../packages/protocol/src/uf2-fixtures.js";
import { APPEARANCE_STORAGE_KEY } from "../../renderer/src/theme/appearance";
import { LifecycleReply } from "../../shared/lifecycle-contracts";
import {
	type MaintenanceCommand,
	MaintenanceReply,
} from "../../shared/maintenance-contracts";
import { MonitorReply, MonitorSnapshot } from "../../shared/monitor-contracts";
import { ProfileReplySchema } from "../../shared/profile-manager";
import { VoiceSurfaceReply } from "../../shared/voice-surface";
import { ClockLive, registerClock, registerClockScheme } from "../clock";
import { ClockStore } from "../clock/clock-store";
import { registerHardware } from "../hardware";
import { startMockHardwareBus } from "../hardware/bus";
import { registerKnob } from "../knob";
import { knobProfileBinding } from "../knob/profile-binding";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { MediaLive, registerMedia } from "../media";
import { registerMonitor } from "../monitor";
import { registerProfiles } from "../profiles";
import { createToneRecorder, registerVoiceSurface } from "../voice";
import { referenceArchive, referenceDecode } from "./archive-fixtures";
import { prepareRestore } from "./backup-store";
import { hashBytes } from "./firmware-files";
import { registerMaintenance } from "./index";
import { smokeScratchPaths } from "./smoke-scratch";

assert.equal(
	process.env.OPEN_QUAKE_MOCK_DEVICE,
	"1",
	"Smoke requires mock device mode",
);
const artifactInput = Schema.decodeUnknownSync(Schema.NonEmptyString)(
	process.argv[2],
);
let artifacts = "";
let directory = "";
let window: BrowserWindow | undefined;
let panel: BrowserWindow | undefined;
const cleanup: (() => Promise<unknown>)[] = [];
const deadline = setTimeout(() => {
	process.stderr.write("Maintenance smoke timed out\n");
	app.exit(1);
}, 45000);
const settle = (ms = 200) => new Promise<void>((done) => setTimeout(done, ms));
// Keep cleanup from triggering Electron's default successful quit before app.exit(1).
app.on("window-all-closed", () => {});
registerClockScheme();
async function smoke() {
	const paths = smokeScratchPaths({
		scratch: process.env.OPEN_QUAKE_SMOKE_SCRATCH,
		temporary: process.env.TMPDIR,
		artifacts: artifactInput,
		userData: app.getPath("userData"),
		home: homedir(),
	});
	artifacts = paths.artifacts;
	directory = mkdtempSync(join(paths.temporary, "oq-maintenance-smoke-"));
	process.stdout.write(`Native runtime: ${JSON.stringify(process.versions)}\n`);
	app.setPath("userData", directory);
	await mkdir(artifacts, { recursive: true });
	await writeFile(
		join(directory, "profiles-v1.json"),
		JSON.stringify({
			schemaVersion: 1,
			profiles: builtinProfiles("darwin").map((p) =>
				Schema.encodeSync(Profile)(p),
			),
			activeByDevice: {},
		}),
	);
	const payload = syntheticUf2();
	const image = join(directory, "synthetic.uf2");
	await writeFile(image, payload);
	const backup = join(directory, "DK-Suite_default_smoke_export_resources.zip");
	dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [image] });
	dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup });
	let confirmation = 1;
	const writeConfirmations: string[] = [];
	dialog.showMessageBox = async (
		first: BaseWindow | MessageBoxOptions,
		second?: MessageBoxOptions,
	) => {
		const options = first instanceof BaseWindow ? second : first;
		if (options?.message === "Write firmware?")
			writeConfirmations.push(options.detail ?? "");
		return { response: confirmation, checkboxChecked: false };
	};
	const otherVolume = join(directory, "other-drive", "QUAKE DFU");
	await mkdir(otherVolume, { recursive: true });
	await writeFile(
		join(otherVolume, "INFO_UF2.TXT"),
		"UF2 Board-ID: QUAKE RP2040",
	);
	await app.whenReady();
	shell.showItemInFolder = () => {};
	// Prove the pinned native bridge loads in this Electron ABI. Do not request any permission.
	const koffi = await import("koffi");
	const core = koffi.load(
		"/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
	);
	assert.equal(
		typeof core.func("bool CGPreflightListenEventAccess(void)"),
		"function",
	);
	const hardwareRuntime = ManagedRuntime.make(HardwareControls.Default);
	cleanup.push(() => hardwareRuntime.dispose());
	const deviceScope = await Effect.runPromise(Scope.make());
	cleanup.push(() => Effect.runPromise(Scope.close(deviceScope, Exit.void)));
	const bus = await hardwareRuntime.runPromise(
		startMockHardwareBus().pipe(Scope.extend(deviceScope)),
	);
	const options = {
		show: false,
		enableLargerThanScreen: true,
		useContentSize: true,
		width: 1100,
		height: 1000,
		webPreferences: {
			preload: resolve("out/preload/index.mjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false,
		},
	};
	window = new BrowserWindow(options);
	panel = new BrowserWindow(options);
	const main = window;
	let connected = true;
	let writerStops = 0;
	const media = registerMedia(
		ManagedRuntime.make(MediaLive(join(directory, "wallpaper-v1"))),
		() => main,
	);
	cleanup.push(() => media.dispose());
	const clockRuntime = ManagedRuntime.make(ClockLive(directory));
	const clock = registerClock(clockRuntime, () => main);
	let originalClockActive = true;
	cleanup.push(() =>
		originalClockActive ? clock.dispose() : Promise.resolve(),
	);
	const externalClock = await mkdtemp(
		join(paths.temporary, "oq-clock-selected-"),
	);
	cleanup.push(() => rm(externalClock, { recursive: true, force: true }));
	const selectedClockImage = join(externalClock, "synthetic-clock.png");
	const selectedClockBytes = nativeImage
		.createFromBitmap(Buffer.alloc(64 * 64 * 4, 0x7f), {
			width: 64,
			height: 64,
		})
		.toPNG();
	await writeFile(selectedClockImage, selectedClockBytes);
	await clockRuntime.runPromise(
		ClockStore.stageMedia("season", selectedClockImage),
	);
	const renderer = pathToFileURL(resolve("out/renderer/index.html")).href;
	const profiles = registerProfiles(() => main, renderer);
	cleanup.push(() => profiles.dispose());
	await profiles.connect("desktop-preview");
	const voice = registerVoiceSurface({
		mock: true,
		tones: createToneRecorder(),
		serial: () => "mock-quake",
		panel: () => panel,
		management: () => main,
		renderer,
	});
	cleanup.push(() => voice.dispose());
	const knob = registerKnob(
		() => panel,
		() => [main, ...(panel ? [panel] : [])],
		{
			profiles: knobProfileBinding(profiles.runtime, profiles.select),
			hardware: () => bus.hardware(),
			voice: voice.knobVoice,
		},
	);
	cleanup.push(() => knob.dispose());
	const removeHardware = registerHardware(
		() => bus.hardware(),
		() => main,
		true,
		renderer,
	);
	cleanup.push(async () => removeHardware());
	const lifecycleRuntime = ManagedRuntime.make(
		DeviceLifecycle.Default({
			mock: true,
			development: true,
			displays: () => [],
			watch: () => () => {},
			panel: () => {},
			bus: () => bus,
			notify: () => {},
			prompts: {
				platform: process.platform,
				mock: true,
				displays: () => [],
				primaryId: () => 1,
				prompt: () => Effect.die("Smoke must never prompt"),
				native: () => Effect.die("Smoke must never alter displays"),
				openSettings: () => Effect.die("Smoke must never open settings"),
			},
		}),
	);
	cleanup.push(() => lifecycleRuntime.dispose());
	const removeLifecycle = registerLifecycle(
		lifecycleRuntime,
		() => main,
		renderer,
	);
	cleanup.push(async () => removeLifecycle());
	let collections = 0;
	const monitor = registerMonitor(
		directory,
		() => main,
		() => panel,
		{
			collect: () =>
				Effect.sync(() => {
					collections++;
					return { state: "unavailable" as const, values: {} };
				}),
		},
		renderer,
	);
	cleanup.push(() => monitor.dispose());
	await writeFile(
		join(directory, "firmware-session-v1.json"),
		"{synthetic-corrupt-session",
	);
	const maintenance = registerMaintenance({
		root: directory,
		mock: true,
		renderer,
		management: () => main,
		hardware: () => (connected ? bus.hardware() : undefined),
		stopWriters: async () => {
			writerStops++;
		},
		exit: () => {
			throw new Error("Smoke must not clear real app data");
		},
		fixture: {
			roots: [join(directory, "firmware-mock"), join(directory, "other-drive")],
			descriptors: [
				{
					board: "QUAKE",
					sha256: hashBytes(payload),
					version: "1.0.21",
					start: 0x12000,
					end: 0x121ff,
				},
			],
		},
	});
	cleanup.push(() => maintenance.dispose());
	await maintenance.ready;
	await main.loadFile(resolve("out/renderer/index.html"));
	await panel.loadFile(resolve("out/renderer/index.html"), {
		query: { surface: "management" },
	});
	const voiceReply: unknown = await main.webContents.executeJavaScript(
		'window.quakeVoice.request({_tag:"Hello"})',
	);
	assert(Schema.is(VoiceSurfaceReply)(voiceReply));
	assert.equal(voiceReply._tag, "ok");
	const profileReply: unknown = await main.webContents.executeJavaScript(
		'window.quakeProfileManager.request({type:"read",locale:"en"})',
	);
	assert(Schema.is(ProfileReplySchema)(profileReply));
	assert.equal(profileReply._tag, "success");
	const lifecycleReply: unknown = await main.webContents.executeJavaScript(
		'window.quakeLifecycle.request({action:"read"})',
	);
	assert(Schema.is(LifecycleReply)(lifecycleReply));
	assert(lifecycleReply.ok);
	const monitorReply = Schema.decodeUnknownSync(MonitorReply)(
		await main.webContents.executeJavaScript(
			'window.quakeMonitor.request({_tag:"read"})',
		),
	);
	assert.equal(monitorReply._tag, "success");
	if (monitorReply._tag !== "success") throw new Error("Monitor read failed");
	const monitorSave = await main.webContents.executeJavaScript(
		`window.quakeMonitor.request(${JSON.stringify({ _tag: "save", revision: monitorReply.view.revision, settings: { ...monitorReply.view.settings, hz: 2 } })})`,
	);
	assert.equal(
		Schema.decodeUnknownSync(MonitorReply)(monitorSave)._tag,
		"success",
	);
	assert.equal(
		Schema.decodeUnknownSync(MonitorReply)(
			await main.webContents.executeJavaScript(
				'window.quakeMonitor.request({_tag:"watch",active:true})',
			),
		)._tag,
		"failure",
	);
	assert.equal(collections, 0, "Management must not start metric collection");
	await panel.webContents.executeJavaScript(
		'window.oqMetricReceipt = new Promise(resolve => { const off = window.quakeMonitor.onMetrics(value => { off(); resolve(value); }); }); window.quakeMonitor.request({_tag:"watch",active:true})',
	);
	await settle(600);
	assert(collections > 0, "Only the owned panel starts collection");
	const metrics: unknown = await panel.webContents.executeJavaScript(
		"window.oqMetricReceipt",
	);
	assert(
		Schema.is(MonitorSnapshot)(metrics),
		"Metrics must reach the production preload subscriber",
	);
	await panel.webContents.executeJavaScript(
		'window.quakeMonitor.request({_tag:"watch",active:false})',
	);
	const stopped = collections;
	await settle(600);
	assert.equal(collections, stopped, "Panel unsubscribe must stop collection");
	const request = async (command: MaintenanceCommand) => {
		const raw: unknown = await main.webContents.executeJavaScript(
			`window.quakeMaintenance.request(${JSON.stringify(command)})`,
		);
		assert(Schema.is(MaintenanceReply)(raw));
		assert(raw.ok, JSON.stringify(raw));
		return raw.view;
	};
	const denied: unknown = await panel.webContents.executeJavaScript(
		'window.quakeMaintenance.request({action:"export"})',
	);
	assert.deepEqual(denied, {
		ok: false,
		code: "QUAKE.SETTINGS.REQUEST_DENIED",
	});
	await main.webContents.executeJavaScript(
		"[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Screen').click()",
	);
	await settle(500);
	assert.equal(
		await main.webContents.executeJavaScript(
			"!!document.querySelector('.clock-settings') && !!document.querySelector('.monitor-settings')",
		),
		true,
		"Clock and monitor settings must coexist",
	);
	await main.webContents.executeJavaScript(
		"document.querySelector('.monitor-settings').scrollIntoView()",
	);
	await settle();
	await writeFile(
		join(artifacts, "combined-screen-monitor.png"),
		(await main.webContents.capturePage()).toPNG(),
	);
	await main.webContents.executeJavaScript(
		"[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Settings').click()",
	);
	await settle(800);
	assert.equal(
		await main.webContents.executeJavaScript(
			"document.querySelector('.page-header h1')?.textContent",
		),
		"Settings",
	);
	await main.webContents.capturePage();
	await settle(300);
	assert(
		(
			await main.webContents.executeJavaScript("document.body.innerText")
		).includes("System Audio Recording"),
	);
	await writeFile(
		join(artifacts, "settings-dark.png"),
		(await main.webContents.capturePage()).toPNG(),
	);
	const restoredAppearance = {
		version: 1,
		theme: "custom",
		customTheme: {
			version: 1,
			name: "Restored fixture",
			base: "dark",
			colors: { accent: "#ff9d52" },
		},
		motion: "reduce",
	};
	await writeFile(
		join(directory, "appearance.json"),
		JSON.stringify(restoredAppearance),
	);
	await main.loadFile(resolve("out/renderer/index.html"));
	await settle(500);
	assert(
		await main.webContents.executeJavaScript(
			`localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)}) === ${JSON.stringify(JSON.stringify(restoredAppearance))}`,
		),
		"Restored theme, custom colors and motion must reach the localStorage consumer",
	);
	await assert.rejects(
		readFile(join(directory, "appearance.json")),
		"Applied appearance receipt must be consumed",
	);
	await main.webContents.executeJavaScript(
		"[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Settings').click()",
	);
	await request({ action: "export" });
	await request({ action: "export" });
	const decoded = referenceDecode(await readFile(backup));
	assert(decoded.has("default_config.json"));
	assert(decoded.has("open-quake/monitor-v1/settings.json"));
	assert(
		Buffer.from(decoded.get("open-quake/appearance.json") ?? []).toString(
			"utf8",
		) === JSON.stringify(restoredAppearance),
		"Export must capture actual renderer appearance",
	);
	await request({ action: "firmware-inspect" });
	confirmation = 0;
	assert.equal(
		(await request({ action: "firmware-start" })).firmware.state,
		"idle",
	);
	await assert.rejects(
		readFile(join(directory, "firmware-mock", "QUAKE DFU", "INFO_UF2.TXT")),
	);
	confirmation = 1;
	await request({ action: "firmware-start" });
	await settle();
	let view = await request({ action: "read" });
	assert.equal(view.firmware.state, "ready_to_write");
	// A fresh management document reconciles the main-owned session and restores its dialog.
	const reloaded = new Promise<void>((done) =>
		main.webContents.once("did-finish-load", () => done()),
	);
	main.webContents.reload();
	await reloaded;
	await settle(1500);
	assert.equal(
		await main.webContents.executeJavaScript(
			"document.querySelector('dialog[open]')?.getAttribute('aria-label')",
		),
		"Firmware Upgrade",
	);
	await main.webContents.executeJavaScript(
		"document.querySelector('[aria-label=\"Close firmware upgrade\"]').click()",
	);
	await settle(1500);
	assert.equal(
		await main.webContents.executeJavaScript(
			"document.querySelector('dialog[open]') === null",
		),
		true,
	);
	await main.webContents.executeJavaScript(
		"[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Settings').click()",
	);
	await settle(200);
	await main.webContents.executeJavaScript(
		"[...document.querySelectorAll('button')].find(b=>b.textContent==='View upgrade').click()",
	);
	await settle();
	assert.equal(view.firmware.volumes.length, 2);
	for (const choice of view.firmware.volumes) {
		assert(
			await main.webContents.executeJavaScript(
				`[...document.querySelectorAll('.firmware-volumes button')].some(button => button.textContent.includes(${JSON.stringify(choice.label)}))`,
			),
		);
	}
	const otherChoice = view.firmware.volumes.find((choice) =>
		choice.label.includes(otherVolume),
	);
	assert(otherChoice);
	confirmation = 0;
	await main.webContents.executeJavaScript(
		`[...document.querySelectorAll('.firmware-volumes button')].find(button => button.textContent.includes(${JSON.stringify(otherChoice.label)})).click()`,
	);
	await settle();
	assert(
		writeConfirmations.at(-1)?.includes(`Selected boot drive: ${otherVolume}.`),
	);
	assert(
		writeConfirmations
			.at(-1)
			?.includes(`Intended device serial: ${view.firmware.serial}.`),
	);
	await assert.rejects(readFile(join(otherVolume, "open-quake-update.uf2")));
	await writeFile(
		join(artifacts, "firmware-drive-confirmations.json"),
		JSON.stringify(writeConfirmations, null, 2),
	);
	await writeFile(
		join(artifacts, "firmware-ready.png"),
		(await main.webContents.capturePage()).toPNG(),
	);
	await main.webContents.executeJavaScript(
		"document.querySelector('[aria-label=\"Close firmware upgrade\"]').click()",
	);
	const volume = view.firmware.volumes[0];
	assert(volume);
	assert(volume.label.includes(join(directory, "firmware-mock", "QUAKE DFU")));
	confirmation = 0;
	assert.equal(
		(await request({ action: "firmware-write", volumeId: volume.id })).firmware
			.state,
		"ready_to_write",
	);
	await assert.rejects(
		readFile(
			join(directory, "firmware-mock", "QUAKE DFU", "open-quake-update.uf2"),
		),
	);
	assert(
		writeConfirmations
			.at(-1)
			?.includes(
				`Selected boot drive: ${join(directory, "firmware-mock", "QUAKE DFU")}.`,
			),
	);
	confirmation = 1;
	await request({ action: "firmware-write", volumeId: volume.id });
	await settle(3000);
	view = await request({ action: "read" });
	assert.equal(view.firmware.state, "success");
	assert.equal(view.currentVersion, "1.0.21");
	await settle(1200);
	await writeFile(
		join(artifacts, "firmware-background-success.png"),
		(await main.webContents.capturePage()).toPNG(),
	);
	await main.webContents.executeJavaScript(
		"[...document.querySelectorAll('button')].find(b=>b.textContent==='View upgrade').click()",
	);
	await settle();
	await writeFile(
		join(artifacts, "firmware-success.png"),
		(await main.webContents.capturePage()).toPNG(),
	);
	await main.webContents.executeJavaScript(
		"document.querySelector('[aria-label=\"Close firmware upgrade\"]').click()",
	);
	await main.webContents.executeJavaScript(
		"document.documentElement.style.colorScheme='light'; document.documentElement.style.setProperty('--quake-background','#f6f6f6');document.documentElement.style.setProperty('--quake-surface','#ffffff');document.documentElement.style.setProperty('--quake-foreground','#1c1c1e');",
	);
	await settle();
	await writeFile(
		join(artifacts, "settings-light.png"),
		(await main.webContents.capturePage()).toPNG(),
	);
	main.setSize(390, 844);
	await settle();
	assert.equal(
		await main.webContents.executeJavaScript(
			"document.documentElement.scrollWidth>innerWidth",
		),
		false,
	);
	await writeFile(
		join(artifacts, "settings-narrow.png"),
		(await main.webContents.capturePage()).toPNG(),
	);
	await request({ action: "firmware-close" });
	const recoverySerial = view.serial;
	assert(recoverySerial);
	connected = false;
	confirmation = 0;
	main.setSize(1100, 1000);
	await main.webContents.executeJavaScript(
		`{ const input = document.querySelector('[aria-label="Recovery device serial"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(recoverySerial)}); input.dispatchEvent(new Event('input', { bubbles: true })); }`,
	);
	await settle();
	const recoverClick =
		"[...document.querySelectorAll('button')].find(b=>b.textContent==='Recover from bootloader').click()";
	await main.webContents.executeJavaScript(recoverClick);
	await settle(300);
	assert.equal((await request({ action: "read" })).firmware.state, "idle");
	await main.webContents.executeJavaScript(
		"document.querySelector('[aria-label=\"Close firmware upgrade\"]').click()",
	);
	await settle();
	confirmation = 1;
	await main.webContents.executeJavaScript(recoverClick);
	await settle(300);
	const recovery = await request({ action: "read" });
	assert.equal(recovery.firmware.state, "ready_to_write");
	assert.equal(
		recovery.currentVersion,
		"",
		"Offline firmware version must remain unknown",
	);
	let recoveryReady = false;
	for (let attempt = 0; attempt < 20 && !recoveryReady; attempt++) {
		await settle(200);
		recoveryReady = await main.webContents.executeJavaScript(
			"[...document.querySelectorAll('dialog[open] .firmware-volumes button')].some(button => button.textContent.includes('Write to QUAKE DFU'))",
		);
	}
	assert(
		recoveryReady,
		"The real recovery dialog must reconcile its ready state",
	);
	await writeFile(
		join(artifacts, "firmware-recovery-ready.png"),
		(await main.webContents.capturePage()).toPNG(),
	);
	const recoveryVolume = recovery.firmware.volumes[0];
	assert(recoveryVolume);
	await rm(
		join(directory, "firmware-mock", "QUAKE DFU", "open-quake-update.uf2"),
	);
	await request({ action: "firmware-write", volumeId: recoveryVolume.id });
	await settle(2800);
	assert.equal(
		(await request({ action: "read" })).firmware.state,
		"verifying",
		"A copied recovery image without intended serial cannot succeed",
	);
	connected = true;
	await settle(2200);
	assert.equal((await request({ action: "read" })).firmware.state, "success");
	await settle(1200);
	await writeFile(
		join(artifacts, "firmware-recovery-success.png"),
		(await main.webContents.capturePage()).toPNG(),
	);
	await main.webContents.executeJavaScript(
		"document.querySelector('[aria-label=\"Close firmware upgrade\"]').click()",
	);
	// Closing through the mounted control already sends firmware-close. Wait for
	// its response instead of racing a second mutation against the same owner.
	let closeSettled = false;
	for (let attempt = 0; attempt < 20 && !closeSettled; attempt++) {
		await settle(100);
		closeSettled = await main.webContents.executeJavaScript(
			"[...document.querySelectorAll('button')].some(button => button.textContent === 'Select UF2…' && !button.disabled)",
		);
	}
	assert(closeSettled, "The mounted close request must complete before import");
	assert.equal((await request({ action: "read" })).firmware.state, "idle");
	const brokenBackup = join(directory, "DK-Suite_default_missing.zip");
	await writeFile(
		brokenBackup,
		referenceArchive(
			new Map([
				[
					"export_index.json",
					Buffer.from(
						JSON.stringify({
							originalBasePath: "/fixture",
							originalPlatform: "darwin",
						}),
					),
				],
				[
					"app/assets/resources.conf",
					Buffer.from(
						JSON.stringify([
							{
								data: [
									{
										id: "missing",
										name: "20,1,1",
										path: "/fixture/missing.json",
										resourceType: "DeviceConfig",
									},
								],
							},
						]),
					),
				],
			]),
			"default",
		),
	);
	dialog.showOpenDialog = async () => ({
		canceled: false,
		filePaths: [brokenBackup],
	});
	const rejected: unknown = await main.webContents.executeJavaScript(
		'window.quakeMaintenance.request({action:"import"})',
	);
	assert(Schema.is(MaintenanceReply)(rejected));
	assert(
		!rejected.ok && rejected.code === "QUAKE.BACKUP.RESTORE_FAILED",
		"Invalid merge must fail before shutdown",
	);
	assert.equal(
		writerStops,
		0,
		"Invalid imports must keep combined owners available",
	);
	await request({ action: "read" });

	// Restore the actual exported clock into another installation, then serve it through the production protocol.
	const restoredRoot = join(directory, "restored-clock-installation");
	await mkdir(restoredRoot);
	await writeFile(
		join(restoredRoot, "profiles-v1.json"),
		await readFile(join(directory, "profiles-v1.json")),
	);
	const restoredBackup = await prepareRestore(await readFile(backup), backup);
	await restoredBackup.validate(restoredRoot);
	await restoredBackup.commit(restoredRoot);
	await rm(externalClock, { recursive: true, force: true });
	await clock.dispose();
	originalClockActive = false;
	const restoredClockRuntime = ManagedRuntime.make(ClockLive(restoredRoot));
	const restoredClock = registerClock(restoredClockRuntime, () => main);
	cleanup.push(() => restoredClock.dispose());
	const mediaPath = await restoredClockRuntime.runPromise(
		ClockStore.mediaPath({ theme: "season" }),
	);
	assert(Option.isSome(mediaPath));
	assert(mediaPath.value.startsWith(`${restoredRoot}/clock-v1/assets/`));
	assert.deepEqual(await readFile(mediaPath.value), selectedClockBytes);
	await main.loadFile(resolve("out/renderer/index.html"));
	await settle(400);
	await main.webContents.executeJavaScript(
		"[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Screen').click()",
	);
	await settle(500);
	assert(
		await main.webContents.executeJavaScript(
			"(() => { const image = document.querySelector('.clock-theme-card[data-theme=season] img'); return image?.currentSrc.startsWith('oq-clock-media://theme/season') && image.naturalWidth === 64; })()",
		),
		"Restored image must load through the real clock protocol after the original is removed",
	);
	await main.webContents.executeJavaScript(
		"document.querySelector('.clock-settings').scrollIntoView()",
	);
	await settle();
	await writeFile(
		join(artifacts, "clock-restored.png"),
		(await main.webContents.capturePage()).toPNG(),
	);
	process.stdout.write(
		"Portable external clock media restored through production protocol PASS\n",
	);

	process.stdout.write(
		"Maintenance native smoke PASS: combined production voice/monitor/profile/lifecycle/hardware/knob/clock/media/maintenance owners, real preload/IPC, monitor save and panel-only collection/disposal, spoofed-window rejection, AES export independently decoded, confirmed backup replacement, actual appearance restore/export, invalid merge rejected before shutdown, four-step firmware dialog, fake scratch-volume write, confirmed recovery without live HID, closed-dialog continuation, intended-serial version re-read, native koffi load, permissions/disabled feed, dark/light/narrow screenshots. Hardware unverified.\n",
	);
}
smoke()
	.then(async () => {
		for (const dispose of cleanup.reverse()) await dispose();
		process.stdout.write(
			"All combined owners disposed before Electron exit PASS\n",
		);
		window?.destroy();
		panel?.destroy();
		await rm(directory, { recursive: true, force: true });
		clearTimeout(deadline);
		app.exit(0);
	})
	.catch(async (cause: unknown) => {
		if (window && !window.isDestroyed()) {
			await writeFile(
				join(artifacts, "maintenance-failure.png"),
				(await window.webContents.capturePage()).toPNG(),
			).catch(() => {});
		}
		process.stderr.write(
			`${cause instanceof Error ? cause.stack : String(cause)}\n`,
		);
		for (const dispose of cleanup.reverse()) await dispose().catch(() => {});
		window?.destroy();
		panel?.destroy();
		if (directory) await rm(directory, { recursive: true, force: true });
		clearTimeout(deadline);
		app.exit(1);
	});
