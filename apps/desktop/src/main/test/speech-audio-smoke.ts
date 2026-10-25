import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, BrowserWindow } from "electron";
import { openAudioWorker } from "../speech/electron-audio";

// Explicit synthetic devices and muted output. Never records a physical mic.
assert.equal(process.env.OPEN_QUAKE_SYNTHETIC_AUDIO_TEST, "1");
const scratch = process.env.OPEN_QUAKE_TEST_SCRATCH;
assert(scratch && isAbsolute(scratch), "Absolute external scratch required");
await mkdir(scratch, { recursive: true });
const directory = await mkdtemp(join(scratch, "speech-electron-"));
app.setPath("userData", directory);
app.setPath("sessionData", directory);
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.commandLine.appendSwitch("mute-audio");
if (process.platform === "darwin") app.setActivationPolicy("prohibited");
app.disableHardwareAcceleration();
// Closing each owned worker must not quit before the next acceptance stage.
app.on("window-all-closed", () => {});
let stage = "app readiness";
const deadline = setTimeout(() => {
	process.stderr.write(`SPEECH_AUDIO_SMOKE_TIMEOUT ${stage}\n`);
	for (const window of BrowserWindow.getAllWindows()) window.destroy();
	app.exit(1);
}, 30_000);
let passed = false;
async function run() {
	try {
		await app.whenReady();
		const controller = new AbortController();
		stage = "capture worker acquisition";
		const worker = await openAudioWorker(controller.signal);
		try {
			const window = BrowserWindow.getAllWindows()[0];
			assert(window && !window.isVisible() && !window.isFocusable());
			assert.equal(
				await window.webContents.executeJavaScript(
					"typeof process === 'undefined' && typeof require === 'undefined'",
				),
				true,
				"Audio worker must have no Node access",
			);
			stage = "synthetic capture start";
			await worker.invoke("capture", ["synthetic-capture"]);
			stage = "synthetic PCM frames";
			let frames = 0;
			let signal = false;
			for (let index = 0; index < 100 && (frames < 3 || !signal); index++) {
				const batch = await worker.invoke<{
					frames: {
						captureId: string;
						seq: number;
						bytes: number[];
						rms: number;
					}[];
					failed: false | string;
				}>("pull");
				assert.equal(batch.failed, false);
				for (const frame of batch.frames) {
					assert.equal(frame.captureId, "synthetic-capture");
					assert.equal(frame.seq, frames++);
					assert.equal(frame.bytes.length, 960);
					assert(frame.rms >= 0 && frame.rms <= 1);
					signal ||= frame.rms > 0;
				}
				await delay(20);
			}
			assert(
				frames >= 3 && signal,
				"Synthetic Chromium input must produce PCM",
			);
			await worker.invoke("stop");
		} finally {
			await worker.close();
		}
		assert.equal(BrowserWindow.getAllWindows().length, 0);
		assert.deepEqual(
			(await readdir(directory)).filter((name) =>
				name.startsWith("speech-worker-"),
			),
			[],
		);
		stage = "output acquisition";
		const output = await openAudioWorker(new AbortController().signal);
		try {
			await output.invoke("ready");
			const start = performance.now();
			stage = "muted natural playback drain";
			await output.invoke("play", [Array(9600).fill(0)]);
			assert(
				performance.now() - start >= 100,
				"Playback must await natural drain",
			);
		} finally {
			await output.close();
		}
		stage = "aborted acquisition cleanup";
		const aborted = new AbortController();
		aborted.abort();
		await assert.rejects(openAudioWorker(aborted.signal));
		assert.equal(BrowserWindow.getAllWindows().length, 0);
		await writeFile(
			join(directory, "result.json"),
			JSON.stringify({
				passed: true,
				syntheticInput: true,
				mutedOutput: true,
				hiddenSandboxedWorker: true,
				framedPcm: true,
				naturalDrain: true,
				workerCleanup: true,
				physicalAudioVerified: false,
			}),
			{ mode: 0o600 },
		);
		passed = true;
		process.stdout.write(`SPEECH_AUDIO_SMOKE_OK ${directory}\n`);
	} catch (cause) {
		process.stderr.write(`SPEECH_AUDIO_SMOKE_FAILED ${stage}\n`);
		// This entry contains only synthetic local audio and no provider settings.
		if (cause instanceof Error) process.stderr.write(`${cause.message}\n`);
	} finally {
		for (const window of BrowserWindow.getAllWindows()) window.destroy();
		clearTimeout(deadline);
		if (!passed) await rm(directory, { recursive: true, force: true });
		app.exit(passed ? 0 : 1);
	}
}
// Let Electron finish ESM startup before awaiting its ready event.
void run();
