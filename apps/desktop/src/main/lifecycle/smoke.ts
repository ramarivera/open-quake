/** Hidden Electron acceptance of the production preload, wizard and lifecycle. Fake HID only. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HardwareControls } from "@open-quake/device";
import { Effect, Exit, ManagedRuntime, Scope } from "effect";
import { app, BrowserWindow } from "electron";
import { registerHardware } from "../hardware";
import { startMockHardwareBus } from "../hardware/bus";
import { registerAppLocale } from "../settings/registration";
import { makeDisplay } from "../test/display";
import { DeviceLifecycle } from "./lifecycle-service";
import { registerLifecycle } from "./registration";

assert.equal(
	process.env.OPEN_QUAKE_MOCK_DEVICE,
	"1",
	"Fake hardware is required",
);
if (process.platform === "darwin") app.setActivationPolicy("prohibited");
const directory = mkdtempSync(join(tmpdir(), "oq-lifecycle-smoke-"));
app.setPath("userData", directory);
const artifacts = process.argv[2] ?? "";
assert(artifacts, "Supply an external screenshot directory");
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function smoke() {
	await app.whenReady();
	await mkdir(artifacts, { recursive: true });
	const renderer = pathToFileURL(resolve("out/renderer/index.html")).href;
	const win = new BrowserWindow({
		show: false,
		width: 1180,
		height: 1000,
		webPreferences: {
			preload: resolve("out/preload/index.mjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			backgroundThrottling: false,
		},
	});
	win.webContents.setAudioMuted(true);
	const hardware = ManagedRuntime.make(HardwareControls.Default);
	const scope = await Effect.runPromise(Scope.make());
	const bus = await hardware.runPromise(
		startMockHardwareBus(false).pipe(Scope.extend(scope)),
	);
	const serial = (await hardware.runPromise(bus.hardware().snapshot())).serial;
	const removeHardware = registerHardware(
		bus.hardware,
		() => win,
		true,
		renderer,
	);
	const locale = registerAppLocale({
		directory,
		osLocale: "en-US",
		renderer,
		windows: () => [win],
	});
	let display = makeDisplay({
		id: 2,
		label: "DK-QUAKE",
		size: { width: 480, height: 1920 },
	});
	const runtime = ManagedRuntime.make(
		DeviceLifecycle.Default({
			mock: true,
			development: false,
			displays: () => [display],
			watch: () => () => {},
			bus: () => bus,
			panel: () => {},
			notify: (status) => win.webContents.send("quake:diagnostic", status),
			prompts: {
				platform: process.platform,
				mock: true,
				displays: () => [display],
				primaryId: () => 1,
				prompt: () => Effect.die("Never prompt in mock smoke"),
				native: () => Effect.die("Never change host displays in mock smoke"),
				openSettings: () => Effect.void,
			},
		}),
	);
	const service = await runtime.runPromise(DeviceLifecycle);
	const removeLifecycle = registerLifecycle(runtime, () => win, renderer);
	const evaluate = <A>(code: string): Promise<A> =>
		win.webContents.executeJavaScript(code);
	const until = async (code: string) => {
		for (let attempt = 0; attempt < 100; attempt++) {
			if (await evaluate<boolean>(code)) return;
			await wait(50);
		}
		assert.fail(`Timed out: ${code}`);
	};
	try {
		await runtime.runPromise(
			service.onStatus(
				{ source: "mock", kind: "status", state: "connected" },
				serial,
			),
		);
		await win.loadURL(renderer);
		await until("!!document.querySelector('.setup')");
		for (const language of ["en", "de"]) {
			await evaluate(
				`window.quakeSettings.saveWizard({step:'display',locale:${JSON.stringify(language)},display:{_tag:'quake',deviceId:${JSON.stringify(serial)}}})`,
			);
			await win.loadURL(renderer);
			await until("!!document.querySelector('.setup-orientation')");
			await until(
				"document.querySelector('.setup-orientation').innerText.includes(" +
					JSON.stringify(
						language === "en" ? "Device connected" : "Gerät verbunden",
					) +
					")",
			);
			assert(
				await evaluate<boolean>(
					"document.querySelector('.setup-actions button:last-child').disabled",
				),
				"Portrait hardware cannot continue",
			);
			await win.webContents.executeJavaScript(
				"document.querySelector('.setup-orientation').scrollIntoView(); null;",
			);
			await wait(80);
			await writeFile(
				join(artifacts, `wizard-${language}-portrait.png`),
				(await win.webContents.capturePage()).toPNG(),
			);
			display = makeDisplay({
				...display,
				size: { width: 1920, height: 480 },
				bounds: { x: 0, y: 0, width: 1920, height: 480 },
				rotation: 270,
			});
			await runtime.runPromise(service.topology(["rotation", "size"]));
			await until(
				"!document.querySelector('.setup-actions button:last-child').disabled",
			);
			assert(
				await evaluate<boolean>(
					"document.querySelector('.setup-orientation [data-ready]').textContent.includes(" +
						JSON.stringify(language === "en" ? "Recommended" : "Empfohlen") +
						")",
				),
			);
			await writeFile(
				join(artifacts, `wizard-${language}-landscape.png`),
				(await win.webContents.capturePage()).toPNG(),
			);
			display = makeDisplay({
				...display,
				size: { width: 480, height: 1920 },
				bounds: { x: 0, y: 0, width: 480, height: 1920 },
				rotation: 0,
			});
			await runtime.runPromise(service.topology(["rotation", "size"]));
		}
		await runtime.runPromise(
			service.onStatus(
				{
					source: "mock",
					kind: "status",
					state: "disconnected",
					reason: "error",
				},
				serial,
			),
		);
		await until("!document.querySelector('.setup')");
		await evaluate("document.querySelector('.setup-resume').click(); null;");
		await until("!!document.querySelector('.setup')");
		await evaluate(
			"document.querySelectorAll('.setup-choices input[type=radio]')[1].click(); null;",
		);
		await until(
			"!document.querySelector('.setup-actions button:last-child').disabled",
		);
		assert.equal(win.isVisible(), false, "Smoke must never take focus");
		console.info(
			"Lifecycle native smoke PASS: EN/DE portrait and 270-degree landscape, hardware continuation gate, disconnect exit, offline preview, hidden window.",
		);
	} finally {
		removeLifecycle();
		removeHardware();
		await runtime.dispose();
		await locale.dispose();
		await Effect.runPromise(Scope.close(scope, Exit.void));
		await hardware.dispose();
		win.destroy();
	}
}
// Native callback failures must exit without a focus-taking Electron error dialog.
const fatal = (cause: unknown): void => {
	console.error(cause);
	app.exit(1);
};
process.on("uncaughtException", fatal);
process.on("unhandledRejection", fatal);

smoke()
	.catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await rm(directory, { recursive: true, force: true });
		app.quit();
	});
