import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, Either, Fiber, Schema } from "effect";
import { app, BrowserWindow } from "electron";
import { PCM_24K } from "../../../../../packages/edge/src/ai/speech/speech-contracts";
import { makeAudioOutput } from "../../../../../packages/edge/src/audio/output-service";
import {
	createDesktopAudioOutput,
	createElectronCaptureDriver,
	openAudioWorker,
} from "../speech/electron-audio";

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
// Electron otherwise opens a native error dialog, blocking a background test
// and its deadline. These fixtures carry no provider or physical audio data.
process.on("uncaughtException", (cause) => {
	process.stderr.write(
		`SPEECH_AUDIO_SMOKE_UNCAUGHT ${stage}\n${cause.stack}\n`,
	);
	app.exit(1);
});
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
				const batch = Schema.decodeUnknownSync(
					Schema.Struct({
						frames: Schema.Array(
							Schema.Struct({
								captureId: Schema.String,
								seq: Schema.Int,
								bytes: Schema.Array(Schema.Int),
								rms: Schema.Number,
							}),
						),
						failed: Schema.Union(Schema.Literal(false), Schema.String),
					}),
				)(await worker.invoke("pull"));
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
		stage = "production recorder driver cleanup";
		const recorder = await Effect.runPromise(
			createElectronCaptureDriver().open("driver-capture"),
		);
		try {
			let received = false;
			for (let index = 0; index < 100 && !received; index++) {
				const batch = await Effect.runPromise(recorder.pull);
				received = batch.frames.some((frame) => frame.bytes.length === 960);
				await delay(20);
			}
			assert(received, "Production driver must pull native synthetic PCM");
			await Effect.runPromise(recorder.stop);
		} finally {
			await Effect.runPromise(recorder.close);
		}
		stage = "failed recorder startup awaits native worker cleanup";
		const failure = await Effect.runPromise(
			createElectronCaptureDriver(async () => {
				// Exercise acquired-worker ownership independently of its signal
				// listener, including asynchronous filesystem teardown.
				const acquired = await openAudioWorker(new AbortController().signal);
				return {
					invoke: async () => {
						throw new Error("synthetic startup refusal");
					},
					close: async () => {
						await delay(25);
						await acquired.close();
					},
				};
			})
				.open("failed-capture")
				.pipe(Effect.either),
		);
		assert(Either.isLeft(failure));
		assert.equal(failure.left.code, "VOICE.CAPTURE.RECORDER_UNAVAILABLE");
		assert.equal(BrowserWindow.getAllWindows().length, 0);
		assert.deepEqual(
			(await readdir(directory)).filter((name) =>
				name.startsWith("speech-worker-"),
			),
			[],
		);
		stage = "late recorder acquisition joins native teardown";
		let finishOpening = () => {};
		const opening = new Promise<void>((resolve) => {
			finishOpening = resolve;
		});
		let entered = () => {};
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let invoked = false;
		let closed = false;
		const pendingRecorder = Effect.runFork(
			createElectronCaptureDriver(async () => {
				const acquired = await openAudioWorker(new AbortController().signal);
				entered();
				await opening;
				return {
					invoke: async <A>() => {
						invoked = true;
						return undefined as A;
					},
					close: async () => {
						await delay(25);
						await acquired.close();
						closed = true;
					},
				};
			}).open("late-capture"),
		);
		await started;
		let interrupted = false;
		const stopping = Effect.runPromise(Fiber.interrupt(pendingRecorder)).then(
			() => {
				interrupted = true;
			},
		);
		await delay(25);
		assert.equal(interrupted, false);
		finishOpening();
		await stopping;
		assert.equal(invoked, false);
		assert.equal(closed, true);
		assert.equal(BrowserWindow.getAllWindows().length, 0);
		assert.deepEqual(
			(await readdir(directory)).filter((name) =>
				name.startsWith("speech-worker-"),
			),
			[],
		);
		stage = "output acquisition";
		const ownership = await Effect.runPromise(makeAudioOutput);
		let stopped = 0;
		const board = await Effect.runPromise(
			ownership.acquire(
				"soundboard",
				Effect.sync(() => {
					stopped++;
				}),
			),
		);
		const outputPort = createDesktopAudioOutput(ownership);
		const output = await Effect.runPromise(outputPort.acquire);
		assert.equal(
			stopped,
			1,
			"Speech must preempt the entire registered soundboard group",
		);
		try {
			await Effect.runPromise(output.ready);
			await Effect.runPromise(output.ready);
			assert.equal(
				BrowserWindow.getAllWindows().length,
				1,
				"Repeated readiness must reuse its worker",
			);
			const busy = await Effect.runPromise(
				ownership.acquire("soundboard", Effect.void).pipe(Effect.either),
			);
			assert(
				Either.isLeft(busy) && busy.left.code === "QUAKE.AUDIO.OUTPUT_BUSY",
			);
			await Effect.runPromise(board.release);
			assert.equal(
				BrowserWindow.getAllWindows().length,
				1,
				"Stale soundboard stop must leave speech alive",
			);
			const start = performance.now();
			stage = "muted natural playback drain";
			await Effect.runPromise(
				output.play({
					bytes: new Uint8Array(9600),
					format: "pcm",
					durationMs: 200,
					provenance: "generation",
					descriptor: PCM_24K,
				}),
			);
			assert(
				performance.now() - start >= 100,
				"Playback must await natural drain",
			);
		} finally {
			await Effect.runPromise(output.stop);
			await Effect.runPromise(output.stop);
		}
		stage = "capture preemption and release";
		const pendingSpeech = await Effect.runPromise(outputPort.acquire);
		await Effect.runPromise(pendingSpeech.ready);
		assert(outputPort.capture);
		const captureLease = await Effect.runPromise(outputPort.capture);
		assert.equal(
			BrowserWindow.getAllWindows().length,
			0,
			"Capture must close native output before mic acquisition",
		);
		const captureBusy = await Effect.runPromise(
			ownership.acquire("soundboard", Effect.void).pipe(Effect.either),
		);
		assert(Either.isLeft(captureBusy));
		await Effect.runPromise(captureLease.stop);
		await Effect.runPromise(pendingSpeech.stop);
		const afterCapture = await Effect.runPromise(
			ownership.acquire("soundboard", Effect.void),
		);
		assert.equal(stopped, 1, "Capture must never auto-resume soundboard");
		await Effect.runPromise(afterCapture.release);
		await Effect.runPromise(ownership.close());
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
				productionCaptureDriver: true,
				failedRecorderStartupCleanup: true,
				lateRecorderInterruptionJoined: true,
				sharedOwnership: true,
				capturePreemption: true,
				staleSoundboardStopSafe: true,
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
