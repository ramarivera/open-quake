/** Explicit development entry. Observes the production preload bridge, never opens HID. */
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Schema } from "effect";
import { app, BrowserWindow, dialog, globalShortcut, shell } from "electron";
import { encodeProfileEnvelope } from "../../../../../../packages/device/src/profiles/profile-contracts";
import type { OpenQuakeBridge } from "../../../preload/quake";
import { guidedProfileEnvelope } from "./guided-profile";
import { finishGuidedCapture } from "./guided-shutdown";
import {
	createGuidedCapture,
	GuidedArrival,
	type GuidedStepId,
} from "./guided-state";
import { acceptanceScratch, ownNativeDevice } from "./native-owner";

interface Recorder {
	drain(): { events: unknown[]; dropped: number };
	prompt(text: string, step?: GuidedStepId): Promise<void>;
	close(): void;
}
/** Self-contained function, serialized into the production panel's main world. */
function installRecorder() {
	const host = window as unknown as {
		openQuake: OpenQuakeBridge;
		__guidedCapture?: Recorder;
	};
	host.__guidedCapture?.close();
	const events: unknown[] = [];
	let dropped = 0;
	let shownStep: GuidedStepId | undefined;
	const record = (event: unknown) =>
		events.push({
			event,
			at: performance.timeOrigin + performance.now(),
			step: shownStep,
		});
	const label = document.createElement("div");
	label.setAttribute("role", "status");
	label.id = "guided-input-prompt";
	label.style.cssText =
		"position:fixed;top:6px;left:12px;right:12px;padding:8px 14px;background:#14181de8;color:white;font:22px sans-serif;z-index:2147483647;pointer-events:none;text-align:center";
	document.body.append(label);
	const off = host.openQuake.onQuakeEvent((event) => {
		if (!["touch", "rotate", "press", "status"].includes(event.kind)) return;
		if (events.length >= 512) {
			dropped++;
			return;
		}
		if (event.kind === "touch")
			record({
				kind: "touch",
				points: event.points
					.slice(0, 5)
					.map((p) => ({ x: p.x, y: p.y, action: p.action })),
			});
		else if (event.kind === "rotate")
			record({ kind: "rotate", direction: event.direction });
		else if (event.kind === "press")
			record({ kind: "press", state: event.state });
		else if (event.kind === "status" && event.state !== "error")
			record({ kind: "status", state: event.state });
	});
	host.__guidedCapture = {
		drain: () => ({ events: events.splice(0), dropped }),
		prompt: async (text, step) => {
			shownStep = undefined;
			label.textContent = text;
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			);
			shownStep = step;
		},
		close: () => {
			off();
			label.remove();
			events.length = 0;
		},
	};
}

let owner: Awaited<ReturnType<typeof ownNativeDevice>> | undefined;
const failStartup = async () => {
	console.error("Guided capture failed. No physical acceptance is claimed.");
	await owner?.close().catch(() => {});
	app.exit(1);
};
process.once("uncaughtException", () => {
	void failStartup();
});
process.once("unhandledRejection", () => {
	void failStartup();
});

assert(!app.isPackaged, "Guided capture is unavailable in packaged apps");
assert.equal(
	process.env.OPEN_QUAKE_GUIDED_CAPTURE,
	"1",
	"Explicit guided capture opt-in required",
);
assert(
	!process.env.ELECTRON_RENDERER_URL,
	"Use production files, not a dev server",
);
const selfTest = process.env.OPEN_QUAKE_GUIDED_CAPTURE_SELF_TEST === "1";
if (selfTest) {
	assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1");
	process.env.OPEN_QUAKE_E2E_RUN = "1";
	globalShortcut.register = () => false;
	app.setLoginItemSettings = () => {};
	dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
	dialog.showSaveDialog = async () => ({ canceled: true, filePath: "" });
	dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
	dialog.showErrorBox = () => {};
	shell.openExternal = async () => {};
	shell.openPath = async () => "Blocked by hidden mock capture";

	if (process.platform === "darwin") app.setActivationPolicy("prohibited");
	app.on("browser-window-created", (_event, win) => {
		win.show = () => {};
		win.showInactive = () => {};
		win.focus = () => {};
		win.moveTop = () => {};
		win.setFocusable(false);
		win.webContents.setBackgroundThrottling(false);
		win.webContents.setAudioMuted(true);
	});
} else
	assert.notEqual(
		process.env.OPEN_QUAKE_MOCK_DEVICE,
		"1",
		"Real capture must not use a mock device",
	);
const directory = resolve(process.argv[2] ?? "");
assert(
	directory.startsWith(`${acceptanceScratch}/guided-run-`),
	"Use a fresh guided-run directory in hardware scratch",
);
await mkdir(directory, { recursive: true, mode: 0o700 });
assert.equal(
	await realpath(directory),
	directory,
	"Capture directory cannot be a symlink",
);
owner = selfTest ? undefined : await ownNativeDevice(directory);
if (!selfTest) {
	assert.equal(
		process.env.OPEN_QUAKE_FAKE_HID_DEVICES,
		undefined,
		"Real capture cannot use custom fake devices",
	);
	const hid = await import("node-hid");
	const devices = await hid.devicesAsync();
	const paths = new Set(
		devices
			.filter(
				(d) =>
					d.vendorId === 0x4158 &&
					d.productId === 0x514b &&
					d.usagePage === 0xff60 &&
					d.usage === 0x61,
			)
			.map((d) => d.path)
			.filter(Boolean),
	);
	assert.equal(
		paths.size,
		1,
		"Connect exactly one QUAKE control device for capture",
	);
}

const userData = join(directory, "userData");
await mkdir(userData, { mode: 0o700 }); // Refuse reuse, including accidental production userData.
await writeFile(
	join(userData, "profiles-v1.json"),
	JSON.stringify(encodeProfileEnvelope(guidedProfileEnvelope())),
	{ flag: "wx", mode: 0o600 },
);
app.setPath("userData", userData);
app.setPath("sessionData", userData);
let code = 1;
let aborted = false;
let captureFinished = false;
let exiting = false;
let captureRun: Promise<void> | undefined;
app.on("will-quit", (event) => {
	event.preventDefault();
	if (exiting) return;
	exiting = true;
	if (!captureFinished) aborted = true;
	void finishGuidedCapture(captureRun, () => owner?.close(), code).then(
		(exitCode) => app.exit(exitCode),
	);
});
await writeFile(
	join(directory, "capture.json"),
	JSON.stringify({
		status: "incomplete",
		physicalAccepted: false,
		reason: "Session has not completed.",
	}),
	{ flag: "wx", mode: 0o600 },
);
await import("../../index");

const Drain = Schema.Struct({
	events: Schema.Array(GuidedArrival).pipe(Schema.maxItems(512)),
	dropped: Schema.Int.pipe(Schema.nonNegative()),
});
const capture = createGuidedCapture(
	() => performance.timeOrigin + performance.now(),
);
process.once("SIGTERM", () => {
	aborted = true;
});
process.once("SIGINT", () => {
	aborted = true;
});
async function run() {
	let panel: BrowserWindow | undefined;
	let currentPrompt = "";
	let reloaded = false;
	try {
		await app.whenReady();
		const startupDeadline = Date.now() + 30000;
		while (!aborted) {
			const candidate = BrowserWindow.getAllWindows().find(
				(win) =>
					!win.isDestroyed() &&
					win.webContents.getURL().includes("surface=panel") &&
					!win.webContents.isLoading(),
			);
			if (!candidate) {
				if (Date.now() > startupDeadline && !panel)
					throw new Error("Panel did not become ready");
				capture.tick();
				if (capture.snapshot().status !== "recording") break;
				await delay(100);
				continue;
			}
			panel = candidate;
			if (
				!(await panel.webContents.executeJavaScript(
					"Boolean(window.__guidedCapture)",
				))
			) {
				await panel.webContents.executeJavaScript(
					`(${installRecorder.toString()})()`,
				);
				currentPrompt = "";
			}
			const snapshot = Schema.decodeUnknownSync(Drain)(
				await panel.webContents.executeJavaScript(
					"window.__guidedCapture.drain()",
				),
			);
			capture.acceptBatch(snapshot.events, snapshot.dropped);
			const step = capture.current();
			if (step && step.id !== currentPrompt) {
				currentPrompt = step.id;
				await panel.webContents.executeJavaScript(
					`window.__guidedCapture.prompt(${JSON.stringify(step.prompt)}, ${JSON.stringify(step.id)})`,
				);
				await writeFile(
					join(directory, "capture.json"),
					JSON.stringify(
						{ ...capture.snapshot(), status: "incomplete", selfTest },
						null,
						2,
					),
					{ mode: 0o600 },
				);
				console.info(`GUIDED INPUT: ${step.prompt}`);
			}
			if (selfTest && step) {
				// Rehearse a new document in the same WebContents before more input.
				if (!reloaded && step.id === "left") {
					reloaded = true;
					panel.reload();
					await delay(100);
					continue;
				}
				const touch = (action: number, x = 100) => ({
					source: "mock",
					kind: "touch",
					points: [{ action, x, y: 100 }],
				});
				const inputs =
					step.goal === "tap"
						? [touch(1), touch(0)]
						: step.goal === "left" || step.goal === "right"
							? Array.from({ length: 5 }, () => ({
									source: "mock",
									kind: "rotate",
									direction: step.goal === "left" ? -1 : 1,
								}))
							: step.goal === "press"
								? [1, 0, 1, 0, 1, 0].map((state) => ({
										source: "mock",
										kind: "press",
										state,
									}))
								: step.goal === "swipe"
									? [touch(1, 10), touch(1, 900), touch(0, 900)]
									: [{ source: "mock", kind: "status", state: step.goal }];
				for (const input of inputs)
					panel.webContents.send("quake:event", input);
			}
			if (capture.snapshot().status !== "recording") break;
			await delay(100);
		}
		if (aborted) capture.stop("aborted");
		if (panel && !panel.isDestroyed()) {
			await panel.webContents.executeJavaScript(
				'window.__guidedCapture.prompt("Capture finished. Physical target accuracy and cursor behavior still need confirmation.")',
			);
			await delay(100);
			await writeFile(
				join(directory, "panel.png"),
				(await panel.webContents.capturePage()).toPNG(),
				{ flag: "wx", mode: 0o600 },
			);
		}
		code = capture.snapshot().status === "observed" ? 0 : 1;
	} catch {
		capture.stop("aborted");
		console.error("Guided capture incomplete; observations retained.");
	} finally {
		await writeFile(
			join(directory, "capture.json"),
			JSON.stringify({ ...capture.snapshot(), selfTest }, null, 2),
			{ mode: 0o600 },
		);
		if (panel && !panel.isDestroyed())
			await panel.webContents
				.executeJavaScript("window.__guidedCapture?.close()")
				.catch(() => {});
		captureFinished = true;
		app.quit();
	}
}
captureRun = run();
