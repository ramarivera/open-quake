/** Hidden native Electron windows, production preload/renderer, mock domain ports only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, ManagedRuntime } from "effect";
import { app, BrowserWindow } from "electron";
import type {
	KnobModelContext,
	KnobVoiceInput,
	VolumeReading,
} from "../../../../../packages/device/src/knob/model/contracts.js";
import type { KnobModelPort } from "../../../../../packages/device/src/knob/model/ports.js";
import { KnobModel } from "../../../../../packages/device/src/knob/model/service.js";
import { MediaLive, registerMedia } from "../media";
import { desktopKnobAdapters } from "./desktop-adapters";
import { makeKnobRuntime, registerKnobRuntime } from "./index";

assert.equal(
	process.env.OPEN_QUAKE_MOCK_DEVICE,
	"1",
	"Native smoke requires mock device mode",
);
const requestedOutput = process.argv[2];
assert(
	requestedOutput && isAbsolute(requestedOutput),
	"Pass an absolute lane screenshot directory",
);
const output = requestedOutput;
mkdirSync(output, { recursive: true });
const directory = mkdtempSync(join(output, "native-user-data-"));
app.setPath("userData", directory);
app.commandLine.appendSwitch("force-device-scale-factor", "1");

async function until(
	check: () => Promise<boolean>,
	label: string,
): Promise<void> {
	const deadline = Date.now() + 5000;
	while (!(await check())) {
		assert(Date.now() < deadline, `Timed out: ${label}`);
		await delay(20);
	}
}
async function smoke(): Promise<void> {
	await app.whenReady();
	const options = {
		show: false,
		frame: false,
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
	const panel = new BrowserWindow(options);
	const management = new BrowserWindow(options);
	const errors: string[] = [];
	panel.webContents.on("console-message", (event) => {
		if (/Uncaught|Error:/.test(event.message)) errors.push(event.message);
	});
	let context: KnobModelContext = {
		session: {
			deviceId: "native-mock",
			sessionId: "native-1",
			profileId: "p0",
			revision: 0,
		},
		profiles: [
			"AI Assistant",
			"Quick Operations",
			"Device Control",
			"Colorful Screen",
			"System Monitor",
			"MeetAI",
			"DK-Player",
			"Chat",
			"Audio",
			"Workspace",
			"Browser",
			"Editor",
			"Studio",
			"Calls",
			"Tools",
			"Custom 1",
			"Custom 2",
		].map((name, index) => ({
			id: `p${index}`,
			name,
			colorful: index === 3,
			thumbnail: { _tag: "missing" },
		})),
		keys: [{ keyCode: "1,1", kind: "vol", visible: true, supportKnob: true }],
		player: true,
	};
	const selected: string[] = [];
	const voice: KnobVoiceInput[] = [];
	const focused: number[] = [];
	const volumes: VolumeReading[] = [];
	const ports: KnobModelPort = {
		selectProfile: (profileId) =>
			Effect.sync(() => {
				selected.push(profileId);
				context = {
					...context,
					session: {
						...context.session,
						sessionId: `native-${selected.length + 1}`,
						profileId,
					},
				};
				return context;
			}),
		voice: (input) =>
			Effect.sync(() => {
				voice.push(input);
			}),
		focusedTurn: (_key, delta) =>
			Effect.sync(() => {
				focused.push(delta);
			}),
		readVolume: Effect.succeed({ level: 50, muted: false }),
		writeVolume: (volume) =>
			Effect.sync(() => {
				volumes.push(volume);
			}),
		warmThumbnails: (profiles) => Effect.succeed(profiles),
	};
	const runtime = makeKnobRuntime(ports);
	const registration = registerKnobRuntime(
		runtime,
		Effect.sync(() => context),
		() => panel,
		() => [panel, management],
		new URL(`file://${resolve("out/renderer/index.html")}`).href,
	);
	const media = registerMedia(
		ManagedRuntime.make(MediaLive(join(directory, "wallpaper"))),
		() => management,
	);
	const model = () => runtime.runPromise(KnobModel.snapshot());
	const send = async (
		event:
			| { _tag: "Rotate"; delta: -1 | 1 }
			| { _tag: "Key"; code: 1 | 2 | 5 | 255 },
	): Promise<void> => {
		const snapshot = await model();
		await runtime.runPromise(
			KnobModel.dispatch({
				...event,
				sessionId: snapshot.context.session.sessionId,
			}),
		);
	};
	const exists = (selector: string) =>
		panel.webContents.executeJavaScript(
			`!!document.querySelector(${JSON.stringify(selector)})`,
		);
	const click = (x: number, y: number): void => {
		panel.webContents.sendInputEvent({
			type: "mouseDown",
			x,
			y,
			button: "left",
			clickCount: 1,
		});
		panel.webContents.sendInputEvent({
			type: "mouseUp",
			x,
			y,
			button: "left",
			clickCount: 1,
		});
	};
	const screenshot = async (name: string): Promise<void> => {
		await until(async () => {
			const expected = await model();
			return panel.webContents.executeJavaScript(
				`(() => { const root=document.querySelector('.knob-overlay-root'); return root?.dataset.session===${JSON.stringify(expected.context.session.sessionId)} && root?.dataset.mode===${JSON.stringify(expected.selector.mode)} && Number(root?.dataset.page)===${expected.selector.page} && Number(root?.dataset.index)===${expected.selector.index}; })()`,
			);
		}, "renderer state before capture");
		await delay(220);
		const image = await panel.webContents.capturePage();
		assert(!image.isEmpty());
		await writeFile(join(output, name), image.toPNG());
	};
	try {
		await Promise.all([
			panel.loadFile(resolve("out/renderer/index.html"), {
				query: { surface: "panel" },
			}),
			management.loadFile(resolve("out/renderer/index.html")),
		]);
		await until(
			async () =>
				!!(await panel.webContents.executeJavaScript(
					"Boolean(document.querySelector('.knob-overlay-root'))",
				)),
			"knob layer initialized",
		);
		// DeviceBus consumer, not a renderer-injected rotation.
		registration.onDevice({ source: "mock", kind: "rotate", direction: 1 });
		await until(
			() => exists('[data-testid="function-wheel"]'),
			"cold-cache FunctionWheel",
		);
		await screenshot("function-wheel.png");
		await until(async () => selected.length === 1, "200ms ring commit");
		assert.equal(selected[0], "p1");
		const png: unknown = await panel.webContents.executeJavaScript(`(() => {
			const canvas = document.createElement('canvas'); canvas.width=960; canvas.height=240;
			const c=canvas.getContext('2d'); c.fillStyle='#15171e'; c.fillRect(0,0,960,240);
			for(let i=0;i<8;i++){ c.fillStyle=['#173244','#253545','#273044','#383044'][i%4]; c.beginPath(); c.roundRect(12+i*119,12,108,216,24); c.fill(); c.fillStyle='#7bced6'; c.font='36px Arial'; c.fillText(['◈','◉','◐','♫'][i%4],44+i*119,125); }
			return canvas.toDataURL('image/png'); })()`);
		assert.equal(typeof png, "string");
		if (typeof png !== "string")
			throw new Error("PNG thumbnail generation failed");
		// Exercise the production managed-thumbnail reader and Electron decoder.
		const thumbnailRoot = join(directory, "profile-thumbnails");
		await mkdir(thumbnailRoot, { recursive: true });
		const hash = (id: string) => createHash("sha256").update(id).digest("hex");
		await writeFile(
			join(thumbnailRoot, `${hash("p0")}.png`),
			Buffer.from(png.split(",")[1] ?? "", "base64"),
		);
		await writeFile(
			join(thumbnailRoot, `${hash("p1")}.png`),
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		);
		const warmed = await Effect.runPromise(
			desktopKnobAdapters(directory).ports.warmThumbnails(context.profiles),
		);
		assert.equal(warmed[0]?.thumbnail._tag, "ready");
		assert.equal(warmed[1]?.thumbnail._tag, "missing");
		context = {
			...context,
			profiles: context.profiles.map((p) => ({
				...p,
				thumbnail: { _tag: "ready", dataUrl: png },
			})),
		};
		await runtime.runPromise(KnobModel.configure(context));
		await send({ _tag: "Rotate", delta: 1 });
		await until(
			() => exists('[data-testid="profile-picker"]'),
			"thumbnail picker",
		);
		await screenshot("thumbnail-picker.png");
		const spoof: unknown = await management.webContents.executeJavaScript(
			`window.quakeKnob.request({_tag:'Page',sessionId:${JSON.stringify(context.session.sessionId)},delta:1})`,
		);
		assert.deepEqual(spoof, {
			_tag: "failure",
			code: "QUAKE.KNOB.CONFIG_INVALID",
		});
		click(1800, 240);
		await until(
			async () => (await model()).selector.page === 1,
			"native page-arrow tap",
		);
		assert.equal((await model()).selector.index, 15);
		await screenshot("thumbnail-picker-page-2.png");
		// A native blank tap dismisses without committing the focused profile.
		click(10, 470);
		await until(
			async () => (await model()).selector.mode === "closed",
			"blank tap dismiss",
		);
		assert.equal(selected.length, 1);
		await send({ _tag: "Rotate", delta: 1 });
		await send({ _tag: "Key", code: 1 });
		assert.equal(selected.at(-1), "p2");
		assert.equal(
			voice.length,
			0,
			"Picker short press must not interrupt voice",
		);
		await send({ _tag: "Rotate", delta: 1 });
		await send({ _tag: "Key", code: 5 });
		await send({ _tag: "Key", code: 255 });
		assert.deepEqual(
			voice.map((v) => v.action),
			["holdStart", "release"],
		);
		await send({ _tag: "Key", code: 1 });
		await send({ _tag: "Key", code: 2 });
		assert.equal(selected.at(-1), "p3");
		await until(
			async () =>
				await panel.webContents.executeJavaScript(
					`document.querySelector('.knob-overlay-root')?.dataset.session===${JSON.stringify(context.session.sessionId)} && !document.querySelector('.knob-picker')`,
				),
			"volume capsule in current profile",
		);
		click(1661, 399);
		await until(
			async () => (await model()).volume.phase === "active",
			"volume activation",
		);
		await send({ _tag: "Rotate", delta: 1 });
		await until(async () => volumes.length === 1, "volume driver write");
		assert.deepEqual(volumes, [{ level: 51, muted: false }]);
		await screenshot("volume-mode.png");
		click(110, 110);
		await until(
			async () => (await model()).focus._tag === "tile",
			"tile focus",
		);
		await send({ _tag: "Rotate", delta: -1 });
		assert.deepEqual(focused, [-1]);
		assert.equal(volumes.length, 1);
		await screenshot("tile-dial.png");
		assert.deepEqual(errors, []);
		process.stdout.write(
			`Knob native smoke PASS: ring, picker, paging, panel-only commands, gesture arbitration, volume and focus. Screenshots: ${output}\n`,
		);
	} finally {
		panel.destroy();
		management.destroy();
		await registration.dispose();
		await media.dispose();
	}
}
let failed = false;
void smoke()
	.catch((error: unknown) => {
		process.stderr.write(`${String(error)}\n`);
		failed = true;
	})
	.finally(async () => {
		await rm(directory, { recursive: true, force: true });
		app.exit(failed ? 1 : 0);
	});
