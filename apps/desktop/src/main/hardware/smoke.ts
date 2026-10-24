/** Native hidden-window smoke. Uses only fake HID; OPEN_QUAKE_MOCK_DEVICE=1 is required. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	HardwareControls,
	type HardwareSession,
	HardwareUnavailable,
	QuakeDevice,
} from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow, powerMonitor } from "electron";
import { HardwareResponse } from "../../shared/hardware-contracts";
import { MediaLive, registerMedia } from "../media";
import { desktopProfilesLive, registerProfiles } from "../profiles/profile-ipc";
import { registerHardware } from "./index";
import { hardwarePreferencesLive } from "./preferences";

const Session = Context.GenericTag<HardwareSession>("HardwareSmokeSession");
let directory: string | undefined;
let disposeRuntime: (() => Promise<void>) | undefined;
let disposeMedia: (() => Promise<void>) | undefined;
let disposeProfiles: (() => Promise<void>) | undefined;
let unregister: (() => void) | undefined;
async function smoke(): Promise<void> {
	assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1");
	const artifacts = process.argv[2];
	assert(artifacts, "Pass the absolute lane screenshot directory");
	assert(
		artifacts.startsWith(
			"/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/hw-controls/",
		),
	);
	await mkdir(artifacts, { recursive: true });
	directory = await mkdtemp(join(artifacts, "native-data-"));
	app.setPath("userData", directory);
	await app.whenReady();
	let hardwareWrites: Effect.Effect<readonly Uint8Array[]> = Effect.succeed([]);
	const source = Layer.scoped(
		Session,
		Effect.gen(function* () {
			const fake = yield* makeFakeHardwareTransport();
			hardwareWrites = fake.writes;
			const device = yield* QuakeDevice.pipe(
				Effect.provide(
					QuakeDevice.DefaultWithoutDependencies.pipe(
						Layer.provide(fake.layer),
					),
				),
			);
			const connection = yield* device.connect();
			const controls = yield* HardwareControls.pipe(
				Effect.provide(
					HardwareControls.DefaultWithoutDependencies.pipe(
						Layer.provide(
							hardwarePreferencesLive(
								join(directory ?? artifacts, "preferences"),
							),
						),
					),
				),
			);
			const session = yield* controls.create(connection, {
				serial: "mock-quake",
				session: "native-smoke",
			});
			yield* session.refresh();
			return session;
		}),
	);
	const runtime = ManagedRuntime.make(source);
	disposeRuntime = () => runtime.dispose();
	const session = await runtime.runPromise(Session);
	let releaseConfigure = () => {};
	const heldConfigure = new Promise<void>((resolve) => {
		releaseConfigure = resolve;
	});
	let holdConfigure = false;
	let rejectRefresh = false;
	const configurations: unknown[] = [];
	const gatedSession: HardwareSession = {
		...session,
		configure: (input) =>
			Effect.suspend(() => {
				configurations.push(input);
				return (
					holdConfigure ? Effect.promise(() => heldConfigure) : Effect.void
				).pipe(Effect.zipRight(session.configure(input)));
			}),
		refresh: () =>
			rejectRefresh
				? Effect.fail(new HardwareUnavailable())
				: session.refresh(),
	};
	let current: HardwareSession | undefined = gatedSession;
	const window = new BrowserWindow({
		show: false,
		width: 1100,
		height: 1000,
		webPreferences: {
			preload: resolve("out/preload/index.mjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	const mediaRuntime = ManagedRuntime.make(
		MediaLive(join(directory, "wallpaper")),
	);
	disposeMedia = registerMedia(mediaRuntime, () => window).dispose;
	disposeProfiles = registerProfiles(
		ManagedRuntime.make(desktopProfilesLive(directory)),
	).dispose;
	unregister = registerHardware(
		() => current,
		() => window,
		true,
	);
	await window.loadFile(resolve("out/renderer/index.html"));
	const js = (script: string): Promise<unknown> =>
		window.webContents.executeJavaScript(script);
	const read = async () => {
		const value = await js('window.quakeHardware.request({_tag:"read"})');
		const reply = Schema.decodeUnknownSync(HardwareResponse)(value);
		assert.equal(reply._tag, "ready");
		if (reply._tag !== "ready") throw new Error("No mock session");
		return reply.snapshot;
	};
	const wait = async (check: () => Promise<boolean>) => {
		const deadline = Date.now() + 4000;
		while (!(await check())) {
			assert(Date.now() < deadline, "Native hardware UI timed out");
			await new Promise<void>((done) => setTimeout(done, 25));
		}
	};
	await js(`document.querySelector('.nav-item[title="Controls"]').click()`);
	await wait(
		async () =>
			(await js(
				'document.querySelector("[data-testid=hardware-firmware]")?.textContent',
			)) === "1.0.21",
	);
	rejectRefresh = true;
	await js(
		`document.querySelector('.hardware-settings .page-header button').click()`,
	);
	await wait(
		async () =>
			(await js(
				'document.querySelector(".hardware-notices").textContent.includes("Device control failed")',
			)) === true,
	);
	rejectRefresh = false;
	await wait(
		async () =>
			(await js(
				'!document.querySelector(".hardware-notices").textContent.includes("Device control failed")',
			)) === true,
	);
	await js('document.querySelector("#knob-led").click()');
	await wait(async () => !(await read()).preferences.knobLedAlwaysOn);
	powerMonitor.emit("lock-screen");
	powerMonitor.emit("unlock-screen");
	await js('document.querySelector("#device-mic").click()');
	await wait(async () => (await read()).mic === false);
	await wait(
		async () =>
			(await js(
				`!document.querySelector('[aria-label="Decrease Device Luminance"]').disabled`,
			)) === true,
	);
	await js(
		`document.querySelector('[aria-label="Decrease Device Luminance"]').click()`,
	);
	await wait(async () => (await read()).luminance === 229);
	await wait(
		async () =>
			(await js('!document.querySelector("#alert-volume").disabled')) === true,
	);
	const moveVolume = async (position: number) => {
		await js(
			`(() => {const slider=document.querySelector("#alert-volume"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(slider,"${position}");slider.dispatchEvent(new Event("input",{bubbles:true}));})()`,
		);
		await new Promise<void>((done) => setTimeout(done, 25));
	};
	const beforePreview = (await runtime.runPromise(hardwareWrites)).length;
	configurations.length = 0;
	holdConfigure = true;
	await moveVolume(53);
	await wait(async () => configurations.length === 1);
	assert.equal(
		await js('document.querySelector("#alert-volume").disabled'),
		false,
		"Slider must stay enabled while configure is pending",
	);
	for (const position of [60, 70, 80]) await moveVolume(position);
	assert.equal(
		await js('document.querySelector("#alert-volume").value'),
		"80",
		"Latest drag position must remain local while IPC is pending",
	);
	assert.equal(
		configurations.length,
		1,
		"Pending slider requests must coalesce",
	);
	holdConfigure = false;
	releaseConfigure();
	await wait(async () => (await read()).preferences.alertVolume === 112);
	assert.equal(configurations.length, 2);
	assert.equal(await js('document.querySelector("#alert-volume").value'), "80");
	await new Promise<void>((done) => setTimeout(done, 650));
	assert.equal((await read()).preferenceStatus, "saved");
	assert.deepEqual(
		(await runtime.runPromise(hardwareWrites))
			.slice(beforePreview)
			.filter((bytes) => bytes[3] === 1 && bytes[4] === 2 && bytes[5] !== 0)
			.map((bytes) => bytes[5]),
		[112, 112],
		"Only the final volume should preview after the 300 ms debounce",
	);
	await wait(
		async () =>
			(await js(
				'!document.querySelector(".hardware-settings").textContent.includes("Saving…")',
			)) === true,
	);
	await js(
		'document.querySelector(".hardware-settings").scrollIntoView(); null;',
	);
	for (const theme of ["dark", "light"]) {
		await js(`document.querySelector('.nav-item[title="Appearance"]').click()`);
		await new Promise<void>((done) => setTimeout(done, 50));
		await js(
			`document.querySelector('input[type="radio"][value="${theme}"]').click()`,
		);
		await js(`document.querySelector('.nav-item[title="Controls"]').click()`);
		await wait(
			async () =>
				(await js(
					'document.querySelector("[data-testid=hardware-firmware]")?.textContent',
				)) === "1.0.21",
		);
		await new Promise<void>((done) => setTimeout(done, 80));
		await writeFile(
			join(artifacts, `hardware-${theme}.png`),
			(await window.webContents.capturePage()).toPNG(),
		);
	}
	window.setSize(390, 844);
	await new Promise<void>((done) => setTimeout(done, 100));
	await js(
		'document.querySelector(".hardware-settings").scrollIntoView(); null;',
	);
	assert.equal(
		await js("document.documentElement.scrollWidth > innerWidth"),
		false,
	);
	await writeFile(
		join(artifacts, "hardware-narrow.png"),
		(await window.webContents.capturePage()).toPNG(),
	);
	current = undefined;
	await wait(
		async () =>
			(await js(
				'document.querySelector(".hardware-settings").textContent.includes("Device not connected")',
			)) === true,
	);
	await writeFile(
		join(artifacts, "hardware-offline.png"),
		(await window.webContents.capturePage()).toPNG(),
	);
	window.destroy();
	process.stdout.write(
		"Hardware native smoke PASS: real preload/IPC, mocked firmware query, LED preference and lock/unlock, mic toggle, 26-step brightness, continuous volume drag/coalescing/persistence, polling error recovery, dark/light/narrow/offline UI. Hardware unverified.\n",
	);
}
async function cleanup() {
	unregister?.();
	await disposeRuntime?.();
	await disposeMedia?.();
	await disposeProfiles?.();
	if (directory) await rm(directory, { recursive: true, force: true });
}
smoke()
	.then(async () => {
		await cleanup();
		app.quit();
	})
	.catch(async (cause: unknown) => {
		process.stderr.write(
			`${cause instanceof Error ? cause.stack : String(cause)}\n`,
		);
		await cleanup();
		app.exit(1);
	});
