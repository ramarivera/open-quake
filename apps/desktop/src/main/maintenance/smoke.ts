import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HardwareControls } from "@open-quake/device";
import { Effect, Exit, ManagedRuntime, Schema, Scope } from "effect";
import { app, BrowserWindow, dialog, shell } from "electron";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import { Profile } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { syntheticUf2 } from "../../../../../packages/protocol/src/uf2-fixtures.js";
import {
	type MaintenanceCommand,
	MaintenanceReply,
} from "../../shared/maintenance-contracts";
import { ClockLive, registerClock, registerClockScheme } from "../clock";
import { startMockHardwareBus } from "../hardware/bus";
import { MediaLive, registerMedia } from "../media";
import { referenceDecode } from "./archive-fixtures";
import { hashBytes } from "./firmware-files";
import { registerMaintenance } from "./index";

assert.equal(
	process.env.OPEN_QUAKE_MOCK_DEVICE,
	"1",
	"Smoke requires mock device mode",
);
const scratch = process.env.TMPDIR;
assert(scratch?.includes("SCRATCHPADS_FOR_AGENTS"), "Scratch TMPDIR required");
const artifacts = Schema.decodeUnknownSync(Schema.NonEmptyString)(
	process.argv[2],
);
assert(artifacts.startsWith("/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/"));
let directory = "";
let window: BrowserWindow | undefined;
let panel: BrowserWindow | undefined;
const cleanup: (() => Promise<unknown>)[] = [];
const deadline = setTimeout(() => {
	process.stderr.write("Maintenance smoke timed out\n");
	app.exit(1);
}, 45000);
const settle = (ms = 200) => new Promise<void>((done) => setTimeout(done, ms));
registerClockScheme();
async function smoke() {
	directory = await mkdtemp(join(tmpdir(), "oq-maintenance-smoke-"));
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
	dialog.showMessageBox = async () => ({
		response: confirmation,
		checkboxChecked: false,
	});
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
	const media = registerMedia(
		ManagedRuntime.make(MediaLive(join(directory, "wallpaper-v1"))),
		() => main,
	);
	cleanup.push(() => media.dispose());
	const clock = registerClock(
		ManagedRuntime.make(ClockLive(directory)),
		() => main,
	);
	cleanup.push(() => clock.dispose());
	const renderer = pathToFileURL(resolve("out/renderer/index.html")).href;
	const maintenance = registerMaintenance({
		root: directory,
		mock: true,
		renderer,
		management: () => main,
		hardware: () => bus.hardware(),
		stopWriters: async () => {},
		exit: () => {
			throw new Error("Smoke must not clear real app data");
		},
		fixture: {
			roots: [join(directory, "firmware-mock")],
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
	await request({ action: "export" });
	const decoded = referenceDecode(await readFile(backup));
	assert(decoded.has("default_config.json"));
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
	await writeFile(
		join(artifacts, "firmware-ready.png"),
		(await main.webContents.capturePage()).toPNG(),
	);
	await main.webContents.executeJavaScript(
		"document.querySelector('[aria-label=\"Close firmware upgrade\"]').click()",
	);
	const volume = view.firmware.volumes[0];
	assert(volume);
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

	process.stdout.write(
		"Maintenance native smoke PASS: real preload/IPC, spoofed-window rejection, AES export independently decoded, four-step firmware dialog, fake scratch-volume write, closed-dialog continuation, version re-read, native koffi load, permissions/disabled feed, dark/light/narrow screenshots. Hardware unverified.\n",
	);
}
smoke()
	.then(async () => {
		for (const dispose of cleanup.reverse()) await dispose();
		window?.destroy();
		panel?.destroy();
		await rm(directory, { recursive: true, force: true });
		clearTimeout(deadline);
		app.exit(0);
	})
	.catch(async (cause: unknown) => {
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
