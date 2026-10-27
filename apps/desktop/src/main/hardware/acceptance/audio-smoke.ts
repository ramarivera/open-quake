/** Explicit real USB microphone acceptance; no synthetic capture or retained samples. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { Cause, Effect } from "effect";
import { app, BrowserWindow, systemPreferences } from "electron";
import { PCM_24K } from "../../../../../../packages/edge/src/ai/speech/speech-contracts.js";
import { makeAudioOutput } from "../../../../../../packages/edge/src/audio/output-service.js";
import { safeCause } from "../../diagnostics/privacy.js";
import {
	createDesktopAudioOutput,
	createElectronCaptureDriver,
} from "../../speech/electron-audio.js";
import { acceptanceDeadline } from "./deadline.js";
import { ownNativeDevice } from "./native-owner.js";
import { acceptanceOptions } from "./policy.js";

let stage = "configuration",
	finished = false;
app.on("window-all-closed", () => {});
app.on("before-quit", (event) => {
	if (!finished) event.preventDefault();
});
if (process.platform === "darwin") app.setActivationPolicy("accessory");
let deadline: ReturnType<typeof acceptanceDeadline> | undefined;
async function run() {
	const options = acceptanceOptions(process.env);
	assert.equal(
		process.env.OPEN_QUAKE_HW_E2E_AUDIO,
		"1",
		"Explicit real microphone opt-in required",
	);
	const owner = await ownNativeDevice(options.directory);
	const directory = owner.directory;
	const bounded = acceptanceDeadline(owner.close, () => {
		console.error("USB microphone acceptance exceeded deadline", stage);
		app.exit(1);
	});
	deadline = bounded;
	const execute = <A, E>(effect: Effect.Effect<A, E>) =>
		Effect.runPromise(effect, { signal: bounded.signal });
	let report: object;
	try {
		await writeFile(
			join(directory, "audio-result.json"),
			JSON.stringify({ status: "incomplete" }),
			{ flag: "wx", mode: 0o600 },
		);
		await mkdir(
			join(directory, "audio-user-data", "Shared Dictionary", "cache"),
			{
				recursive: true,
				mode: 0o700,
			},
		);
		app.setPath("userData", join(directory, "audio-user-data"));
		app.setPath("sessionData", join(directory, "audio-user-data"));
		await app.whenReady();
		stage = "microphone-permission";
		const permission = systemPreferences.getMediaAccessStatus("microphone");
		assert.equal(
			permission,
			"granted",
			"Native microphone permission must already be granted",
		);
		const driver = createElectronCaptureDriver();
		let tailFrames = 0;
		let frames = 0,
			maxRms = 0,
			sequence = 0;
		const checks: string[] = [];
		for (let cycle = 0; cycle < 2; cycle++) {
			stage = "capture-open";
			const recorder = await execute(
				driver.open(`native-usb-capture-${cycle}`),
			);
			const removeRecorder = bounded.add(() =>
				Effect.runPromise(recorder.close),
			);
			try {
				const window = BrowserWindow.getAllWindows()[0];
				assert(window);
				assert.equal(window.isVisible(), false);
				const selectedUsb: unknown = await window.webContents.executeJavaScript(
					`navigator.mediaDevices.enumerateDevices().then(devices=>devices.some(d=>d.kind==='audioinput' && d.deviceId==='default' && /USB PnP Audio Device/i.test(d.label)))`,
				);
				assert.equal(
					selectedUsb,
					true,
					"Default input must be the expected USB microphone",
				);
				checks.push(`usb-input-selected-${cycle}`);
				sequence = 0;
				const pull = async (tail = false) => {
					const batch = await execute(recorder.pull);
					for (const frame of batch.frames) {
						assert.equal(frame.seq, sequence++);
						if (tail) {
							assert(
								frame.bytes.length > 0 &&
									frame.bytes.length <= 960 &&
									frame.bytes.length % 2 === 0,
							);
							if (frame.bytes.length < 960) tailFrames++;
						} else assert.equal(frame.bytes.length, 960);
						assert(
							Number.isFinite(frame.rms) && frame.rms >= 0 && frame.rms <= 1,
						);
						maxRms = Math.max(maxRms, frame.rms);
						frames++;
					}
					return batch;
				};
				stage = "capture-frames";
				const until = Date.now() + 1500;
				while (Date.now() < until) {
					await pull();
					await delay(20);
				}
				assert(
					sequence >= 20,
					"Real microphone must produce ordered PCM frames",
				);
				checks.push(`native-pcm-framing-${cycle}`);
				assert(recorder.pause && recorder.resume);
				await execute(recorder.pause);
				for (let n = 0; n < 100; n++) {
					if ((await pull()).frames.length === 0) break;
				}
				await delay(120);
				assert.equal(
					(await pull()).frames.length,
					0,
					"Paused capture must not generate frames",
				);
				checks.push(`pause-stops-frames-${cycle}`);
				await execute(recorder.resume);
				await delay(120);
				assert(
					(await pull()).frames.length > 0,
					"Resuming capture must restart frames",
				);
				checks.push(`resume-generates-frames-${cycle}`);
				stage = "capture-stop";
				await execute(recorder.stop);
				let done = false;
				for (let n = 0; n < 100 && !done; n++) done = (await pull(true)).done;
				assert(
					done,
					"Stop must release tracks and finish the bounded PCM tail",
				);
				checks.push(`stop-drain-completes-${cycle}`);
			} finally {
				try {
					await Effect.runPromise(recorder.close);
				} finally {
					removeRecorder();
				}
			}
			assert.equal(BrowserWindow.getAllWindows().length, 0);
			assert.equal(
				(await readdir(join(directory, "audio-user-data"))).filter((name) =>
					name.startsWith("speech-worker-"),
				).length,
				0,
			);
			checks.push(`worker-cleanup-${cycle}`);
		}
		if (tailFrames > 0) checks.push("partial-pcm-tail-observed");
		stage = "native-output";
		const ownership = await execute(makeAudioOutput);
		const port = createDesktopAudioOutput(ownership);
		const output = await execute(port.acquire);
		const removeOutput = bounded.add(() => Effect.runPromise(output.stop));
		try {
			await execute(output.ready);
			assert(output.resume && output.contextState);
			await execute(output.resume);
			assert.equal(await execute(output.contextState), "running");
			const bytes = new Uint8Array(24000 * 2 * 0.25);
			const view = new DataView(bytes.buffer);
			for (let index = 0; index < bytes.length / 2; index++)
				view.setInt16(
					index * 2,
					Math.round(Math.sin((2 * Math.PI * 660 * index) / 24000) * 900),
					true,
				);
			const start = performance.now();
			await execute(
				output.play({
					bytes,
					format: "pcm",
					durationMs: 250,
					descriptor: PCM_24K,
					provenance: "generation",
				}),
			);
			assert(
				performance.now() - start >= 150,
				"Native output must await playback drain",
			);
			checks.push("native-speaker-playback-drain");
		} finally {
			try {
				await Effect.runPromise(output.stop);
			} finally {
				removeOutput();
			}
		}
		assert.equal(BrowserWindow.getAllWindows().length, 0);
		checks.push("native-output-worker-cleanup");
		report = {
			status: "passed",
			mode: "real-usb-capture-and-output",
			revision: (
				await promisify(execFile)("git", ["rev-parse", "HEAD"])
			).stdout.trim(),
			dirty:
				(
					await promisify(execFile)("git", ["status", "--porcelain"])
				).stdout.trim().length > 0,
			fixtureBundleSha256: createHash("sha256")
				.update(await readFile(new URL(import.meta.url)))
				.digest("hex"),
			checks,
			frames,
			maxRms,
			tailFrames,
			partialTailCoverage: tailFrames > 0 ? "passed" : "unexercised",
			retainedAudioSamples: false,
			providerLoopVerified: false,
		};
	} finally {
		await owner.close();
	}
	await writeFile(
		join(directory, "audio-result.json"),
		JSON.stringify(report, null, 2),
		{ mode: 0o600 },
	);
	console.info(
		"Real USB audio acceptance PASS: capture, PCM, pause/resume, native playback and cleanup",
	);
}
run().then(
	() => {
		finished = true;
		deadline?.finish();
		app.quit();
	},
	(cause) => {
		finished = true;
		deadline?.finish();
		console.error(
			"Real USB microphone acceptance failed",
			JSON.stringify({ stage, cause: safeCause(Cause.die(cause)) }),
		);
		app.exit(1);
	},
);
