/** Explicit supervised native fixture. Never imported by the product or default tests. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { app, BrowserWindow } from "electron";
import { canonicalHidSerial } from "../../../../../../packages/device/src/device-contracts.js";
import { QuakeDevice } from "../../../../../../packages/device/src/device-service.js";
import { HardwareControls } from "../../../../../../packages/device/src/hardware/hardware-service.js";
import { HidTransport } from "../../../../../../packages/device/src/hid-transport.js";
import { NodeHidLive } from "../../../../../../packages/device/src/node-hid.js";
import { createDesktopDiagnostics } from "../../diagnostics/index.js";
import { makeDesktopRuntime } from "../../diagnostics/runtime.js";
import { exactDeviceTransport } from "./exact-device.js";
import { ownNativeDevice } from "./native-owner.js";
import { acceptanceOptions } from "./policy.js";

async function run() {
	const options = acceptanceOptions(process.env);
	assert.equal(
		process.env.OPEN_QUAKE_HW_E2E_KEYBOARD_READY,
		"1",
		"Requires a fresh supervised hands-off acknowledgement",
	);
	const owner = await ownNativeDevice(options.directory);
	try {
		await writeFile(
			join(options.directory, "keyboard-result.json"),
			JSON.stringify({ id: "keyboard", status: "incomplete" }),
			{ flag: "wx", mode: 0o600 },
		);
		await mkdir(join(options.directory, "keyboard-user-data"), {
			recursive: true,
			mode: 0o700,
		});
		app.setPath("userData", join(options.directory, "keyboard-user-data"));
		await app.whenReady();
		const window = new BrowserWindow({
			width: 680,
			height: 240,
			show: false,
			webPreferences: { sandbox: true, contextIsolation: true },
		});
		const diagnostics = createDesktopDiagnostics({
			directory: join(options.directory, "keyboard-diagnostics"),
			stdout: false,
		});
		const runtime = makeDesktopRuntime(
			QuakeDevice.DefaultWithoutDependencies.pipe(
				Layer.provide(
					Layer.effect(
						HidTransport,
						Effect.map(HidTransport, (source) =>
							exactDeviceTransport(source, options.serial),
						),
					).pipe(Layer.provide(NodeHidLive)),
				),
			),
			diagnostics,
			"voice.device",
		);
		try {
			await window.loadURL(
				`data:text/html,${encodeURIComponent('<title>QUAKE keyboard acceptance</title><h2>QUAKE keyboard acceptance</h2><p>Please leave your keyboard and mouse untouched. This test types one letter and closes itself.</p><textarea id="target" aria-label="QUAKE keyboard test target"></textarea><script>window.keyReleased=false; addEventListener("keyup",e=>{if(e.code==="KeyA")window.keyReleased=true;});</script>')}`,
			);
			await runtime.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const device = yield* QuakeDevice;
						const devices = yield* device.discover();
						const chosen = devices.filter(
							(info) =>
								canonicalHidSerial(info.serialNumber ?? "") === options.serial,
						);
						assert.equal(chosen.length, 1);
						const identity = chosen[0];
						assert(identity);
						const connection = yield* device.connect({ path: identity.path });
						const controls = yield* HardwareControls.pipe(
							Effect.provide(HardwareControls.Default),
						);
						const session = yield* controls.create(connection, {
							serial: options.serial,
							session: "keyboard-acceptance",
						});
						yield* Effect.promise(async () => {
							window.show();
							window.focus();
							await window.webContents.executeJavaScript(
								'document.querySelector("#target").focus()',
							);
							assert(
								window.isFocused(),
								"Test target must own focus before hardware emits a key",
							);
						});
						yield* session.pressChord("a");
						for (let attempt = 0; attempt < 20; attempt++) {
							const received: unknown = yield* Effect.promise(() =>
								window.webContents.executeJavaScript(
									'({typed: document.querySelector("#target").value === "a", released: window.keyReleased})',
								),
							);
							if (
								typeof received === "object" &&
								received &&
								"typed" in received &&
								received.typed === true &&
								"released" in received &&
								received.released === true
							)
								return;
							yield* Effect.sleep(100);
						}
						assert.fail(
							"The owned target did not observe the device key and release",
						);
					}),
				).pipe(Effect.timeout("15 seconds")),
			);
			await writeFile(
				join(options.directory, "keyboard-result.json"),
				JSON.stringify({
					id: "keyboard",
					mode: "native",
					status: "passed",
					typed: true,
					released: true,
				}),
				{ mode: 0o600 },
			);
			console.info(
				"QUAKE keyboard E2E PASS: native key and release reached the owned target",
			);
		} finally {
			window.destroy();
			await runtime.dispose();
			await diagnostics.close();
		}
	} finally {
		await owner.close();
	}
}

run().then(
	() => app.quit(),
	() => {
		console.error("QUAKE keyboard E2E failed; inspect retained diagnostics");
		app.exit(1);
	},
);
