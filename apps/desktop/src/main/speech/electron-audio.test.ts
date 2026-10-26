import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { it as effectIt } from "@effect/vitest";
import { Effect, Fiber, TestClock } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PCM_24K } from "../../../../../packages/edge/src/ai/speech/speech-contracts";
import { playbackWatchdog } from "../../../../../packages/edge/src/ai/speech/speech-watchdog";
import { makeAudioOutput } from "../../../../../packages/edge/src/audio/output-service";

const native = vi.hoisted(() => ({
	root: "",
	contextState: "suspended",
	resumes: 0,
	end: () => {},
	failWindow: false,
	failWrite: false,
	captureError: "",
	windows: [] as { url: string; destroyed: boolean }[],
	contents: [] as unknown[],
	sessions: [] as {
		request: (...args: unknown[]) => unknown;
		check: (...args: unknown[]) => unknown;
	}[],
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		writeFile: (...args: Parameters<typeof fs.writeFile>) =>
			native.failWrite
				? Promise.reject(new Error("synthetic write failure"))
				: fs.writeFile(...args),
	};
});
vi.mock("electron", () => ({
	app: { getPath: () => native.root },
	systemPreferences: {},
	session: {
		fromPartition: () => {
			const state = { request: () => {}, check: () => {} };
			native.sessions.push(state);
			return {
				setPermissionRequestHandler: (fn: (...args: unknown[]) => unknown) => {
					state.request = fn;
				},
				setPermissionCheckHandler: (fn: (...args: unknown[]) => unknown) => {
					state.check = fn;
				},
			};
		},
	},
	BrowserWindow: class {
		context = {
			DOMException,
			navigator: {
				mediaDevices: {
					getUserMedia: async () => {
						throw new DOMException(
							"private input details",
							native.captureError,
						);
					},
				},
			},
			AudioBufferSourceNode: class {},
			AudioContext: class {
				get state() {
					return native.contextState;
				}
				destination = {};
				async resume() {
					if (++native.resumes > 1) native.contextState = "running";
				}
				async close() {
					native.contextState = "closed";
				}
				createBuffer(_channels: number, count: number) {
					return { getChannelData: () => new Float32Array(count) };
				}
				createBufferSource() {
					const source = {
						buffer: undefined,
						onended: () => {},
						connect() {},
						start() {},
						stop() {},
						disconnect() {},
					};
					native.end = () => source.onended();
					return source;
				}
			},
		};
		state = { url: "", destroyed: false };
		constructor() {
			if (native.failWindow) throw new Error("synthetic window failure");
			native.windows.push(this.state);
			native.contents.push(this.webContents);
		}
		webContents = {
			setWindowOpenHandler: () => {},
			on: () => {},
			getURL: () => this.state.url,
			executeJavaScript: async (code: string) => {
				try {
					return await runInNewContext(code, this.context);
				} catch (cause) {
					// Electron drops DOMException properties across executeJavaScript.
					if (cause instanceof DOMException) throw {};
					throw cause;
				}
			},
		};
		isDestroyed() {
			return this.state.destroyed;
		}
		destroy() {
			this.state.destroyed = true;
		}
		async loadURL(url: string) {
			this.state.url = url;
		}
	},
}));

import {
	createDesktopAudioOutput,
	createElectronCaptureDriver,
	openAudioWorker,
} from "./electron-audio";

beforeEach(async () => {
	native.root = await mkdtemp(join(tmpdir(), "oq-audio-test-"));
	native.contextState = "suspended";
	native.resumes = 0;
	native.end = () => {};
	native.failWrite = false;
	native.failWindow = false;
	native.captureError = "";
	native.windows.length = 0;
	native.sessions.length = 0;
	native.contents.length = 0;
});
afterEach(async () => {
	await rm(native.root, { recursive: true });
});
describe("owned Electron audio worker", () => {
	it.each([
		["NotAllowedError", "VOICE.CAPTURE.PERMISSION_DENIED"],
		["NotFoundError", "VOICE.CAPTURE.NO_DEVICE"],
		["OverconstrainedError", "VOICE.CAPTURE.NO_DEVICE"],
		["NotReadableError", "VOICE.CAPTURE.RECORDER_UNAVAILABLE"],
	])(
		"preserves %s across the native rejection boundary",
		async (name, code) => {
			native.captureError = name;
			const result = await Effect.runPromise(
				createElectronCaptureDriver().open("capture").pipe(Effect.either),
			);
			expect(result).toMatchObject({ _tag: "Left", left: { code } });
			expect(JSON.stringify(result)).not.toContain("private input details");
			expect(native.windows.every((window) => window.destroyed)).toBe(true);
			expect(await readdir(native.root)).toEqual([]);
		},
	);
	it.each(["write", "window"])(
		"removes its private directory when %s setup fails",
		async (failure) => {
			native.failWrite = failure === "write";
			native.failWindow = failure === "window";
			await expect(
				openAudioWorker(new AbortController().signal),
			).rejects.toThrow();
			expect(await readdir(native.root)).toEqual([]);
		},
	);
	it("grants audio only to the exact top-level worker and denies child frames/other URLs", async () => {
		const worker = await openAudioWorker(new AbortController().signal);
		const state = native.windows[0];
		const policy = native.sessions[0];
		if (!state || !policy) throw new Error("worker");
		// Contents identity is kept in the registered closure. Obtain it through the mocked instance below.
		const instance = native.contents[0];
		const ask = (details: unknown, contents: unknown = instance) => {
			let result: unknown;
			policy.request(
				contents,
				"media",
				(allowed: boolean) => {
					result = allowed;
				},
				details,
			);
			return result;
		};
		expect(
			ask({
				isMainFrame: true,
				requestingUrl: state.url,
				mediaTypes: ["audio"],
			}),
		).toBe(true);
		expect(
			ask({
				isMainFrame: false,
				requestingUrl: state.url,
				mediaTypes: ["audio"],
			}),
		).toBe(false);
		expect(
			ask({
				isMainFrame: true,
				requestingUrl: "https://other.invalid",
				mediaTypes: ["audio"],
			}),
		).toBe(false);
		expect(
			ask({
				isMainFrame: true,
				requestingUrl: state.url,
				mediaTypes: ["video"],
			}),
		).toBe(false);
		expect(
			ask({ isMainFrame: true, requestingUrl: state.url, mediaTypes: [] }),
		).toBe(false);
		expect(
			ask(
				{ isMainFrame: true, requestingUrl: state.url, mediaTypes: ["audio"] },
				{},
			),
		).toBe(false);
		await worker.close();
		expect(state.destroyed).toBe(true);
		expect(await readdir(native.root)).toEqual([]);
	});
});

effectIt.scoped(
	"resumes suspended playback at 8 s through the production worker bridge",
	() =>
		Effect.gen(function* () {
			const ownership = yield* makeAudioOutput;
			const lease = yield* createDesktopAudioOutput(ownership).acquire;
			yield* Effect.addFinalizer(() => lease.stop);
			yield* lease.ready;
			const contextState = lease.contextState;
			const resume = lease.resume;
			if (!contextState || !resume) throw new Error("missing watchdog methods");
			const playback = yield* lease
				.play({
					bytes: new Uint8Array(480000),
					format: "pcm",
					descriptor: PCM_24K,
					durationMs: 10000,
					provenance: "generation",
				})
				.pipe(
					Effect.raceFirst(
						playbackWatchdog(
							10000,
							() => contextState.pipe(Effect.orElseSucceed(() => "closed")),
							() => resume.pipe(Effect.orElseSucceed(() => undefined)),
						),
					),
					Effect.forkScoped,
				);
			yield* TestClock.adjust(7999);
			expect(native.resumes).toBe(1);
			yield* TestClock.adjust(1);
			yield* Effect.yieldNow().pipe(Effect.repeatN(10));
			expect(native.contextState).toBe("running");
			expect(native.resumes).toBe(2);
			native.end();
			yield* Fiber.join(playback);
		}),
);
