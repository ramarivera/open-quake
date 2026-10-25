import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Either, Layer, Schema } from "effect";
import { app, BrowserWindow, session, systemPreferences } from "electron";
import { AiUnavailable } from "../../../../../packages/edge/src/ai/ai-errors";
import { verifiedAudio } from "../../../../../packages/edge/src/ai/speech/speech-audio";
import type { GeneratedAudio } from "../../../../../packages/edge/src/ai/speech/speech-contracts";
import {
	SpeechHttp,
	SpeechOutput,
	SpeechWebSocket,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { audioWorkerSource } from "./audio-worker";
import type { CaptureDriver } from "./capture";
import { DesktopSpeechError } from "./errors";
import { desktopWebSocket } from "./websocket";

export interface AudioWorker {
	readonly invoke: <A>(method: string, args?: readonly unknown[]) => Promise<A>;
	readonly close: () => Promise<void>;
}
/** No window exists until a user starts capture/playback. The worker never shows or focuses. */
export async function openAudioWorker(
	signal: AbortSignal,
): Promise<AudioWorker> {
	const directory = await mkdtemp(
		join(app.getPath("sessionData"), "speech-worker-"),
	);
	const file = join(directory, "audio.html");
	await writeFile(
		file,
		"<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-eval'\"><title>Speech audio worker</title>",
		{ mode: 0o600 },
	);
	const audioSession = session.fromPartition("speech-audio");
	const window = new BrowserWindow({
		show: false,
		focusable: false,
		webPreferences: {
			session: audioSession,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false,
			autoplayPolicy: "no-user-gesture-required",
		},
	});
	let closed = false;
	let closing: Promise<void> | undefined;
	const close = (): Promise<void> => {
		if (closing) return closing;
		closed = true;
		signal.removeEventListener("abort", abort);
		if (!window.isDestroyed()) window.destroy();
		closing = rm(directory, { recursive: true, force: true });
		return closing;
	};
	const abort = () => {
		// The owning finalizer awaits the same promise and reports cleanup failure.
		void close().catch(() => undefined);
	};
	signal.addEventListener("abort", abort, { once: true });
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (event) => event.preventDefault());
	audioSession.setPermissionRequestHandler(
		(contents, permission, callback, details) =>
			callback(
				contents === window.webContents &&
					permission === "media" &&
					"mediaTypes" in details &&
					details.mediaTypes.every((type) => type === "audio"),
			),
	);
	audioSession.setPermissionCheckHandler(
		(contents, permission, _origin, details) =>
			contents === window.webContents &&
			permission === "media" &&
			details.isMainFrame &&
			details.mediaType === "audio",
	);
	try {
		if (signal.aborted) {
			await close();
			throw new AiUnavailable();
		}
		await window.loadURL(pathToFileURL(file).href);
		await window.webContents.executeJavaScript(audioWorkerSource());
		if (closed) throw new AiUnavailable();
		return {
			invoke: (method, args = []) => {
				if (closed || !/^(capture|pull|ready|play|stop)$/.test(method))
					return Promise.reject(new AiUnavailable());
				return window.webContents.executeJavaScript(
					`globalThis.__quakeSpeech.${method}(...${JSON.stringify(args)})`,
				);
			},
			close,
		};
	} catch (cause) {
		await close();
		throw cause;
	}
}
const Batch = Schema.Struct({
	frames: Schema.Array(
		Schema.Struct({
			captureId: Schema.String,
			seq: Schema.Int,
			bytes: Schema.Array(Schema.Int.pipe(Schema.between(0, 255))),
			rms: Schema.Number,
		}),
	),
	done: Schema.Boolean,
	failed: Schema.Union(
		Schema.Literal(false),
		Schema.Literal("overflow", "recorder"),
	),
});
const boundary = <A>(run: () => Promise<A>) =>
	Effect.tryPromise({ try: run, catch: (cause) => new AiUnavailable(cause) });
export function createElectronCaptureDriver(
	open = openAudioWorker,
): CaptureDriver {
	return {
		permission: boundary(
			async () =>
				process.platform !== "darwin" ||
				systemPreferences.getMediaAccessStatus("microphone") === "granted" ||
				(await systemPreferences.askForMediaAccess("microphone")),
		),
		open: (id) =>
			Effect.gen(function* () {
				const controller = new AbortController();
				const worker = yield* Effect.tryPromise({
					try: async (signal) => {
						signal.addEventListener("abort", () => controller.abort(), {
							once: true,
						});
						const value = await open(controller.signal);
						if (controller.signal.aborted) {
							await value.close();
							throw new AiUnavailable();
						}
						await value.invoke("capture", [id]);
						return value;
					},
					catch: (cause) =>
						cause instanceof Error && cause.name === "NotAllowedError"
							? new DesktopSpeechError("PermissionDenied", "permission", cause)
							: new DesktopSpeechError(
									"RecorderUnavailable",
									"recorder",
									cause,
								),
				}).pipe(
					Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
					Effect.onError(() => Effect.sync(() => controller.abort())),
				);
				return {
					pull: boundary(() => worker.invoke<unknown>("pull")).pipe(
						Effect.flatMap(Schema.decodeUnknown(Batch)),
						Effect.mapError((cause) => new AiUnavailable(cause)),
						Effect.flatMap((batch) =>
							batch.failed
								? Effect.fail(
										new DesktopSpeechError(
											batch.failed === "overflow"
												? "BufferOverflow"
												: "RecorderUnavailable",
											"capture",
										),
									)
								: Effect.succeed({
										frames: batch.frames.map((frame) => ({
											...frame,
											bytes: Uint8Array.from(frame.bytes),
										})),
										done: batch.done,
									}),
						),
					),
					stop: boundary(() => worker.invoke("stop")).pipe(
						Effect.timeout("2 seconds"),
						Effect.orElse(() =>
							Effect.promise(async () => {
								controller.abort();
								await worker.close();
							}),
						),
						Effect.asVoid,
					),
					close: Effect.promise(async () => {
						controller.abort();
						await worker.close();
					}),
				};
			}),
	};
}
export function createDesktopAudioOutput(
	open = openAudioWorker,
): typeof SpeechOutput.Service {
	let active: { stop: Effect.Effect<void> } | undefined;
	return {
		suspendForCapture: Effect.suspend(() => active?.stop ?? Effect.void),
		acquire: Effect.gen(function* () {
			if (active) yield* active.stop;
			const controller = new AbortController();
			let worker: AudioWorker | undefined;
			const lease = {
				ready: boundary(async () => {
					worker = await open(controller.signal);
					if (controller.signal.aborted) {
						await worker.close();
						throw new AiUnavailable();
					}
					await worker.invoke("ready");
				}).pipe(
					Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
				),
				play: (audio: GeneratedAudio) =>
					Effect.gen(function* () {
						const verified = verifiedAudio(audio.bytes, audio.format);
						if (Either.isLeft(verified))
							return yield* new AiUnavailable(verified.left);
						let pcm = audio.bytes;
						if (audio.format === "wav") {
							const view = new DataView(
								pcm.buffer,
								pcm.byteOffset,
								pcm.byteLength,
							);
							for (let offset = 12; offset + 8 <= pcm.length; ) {
								const size = view.getUint32(offset + 4, true);
								if (
									String.fromCharCode(...pcm.subarray(offset, offset + 4)) ===
									"data"
								) {
									pcm = pcm.subarray(
										offset + 8,
										size === 0xffffffff ? undefined : offset + 8 + size,
									);
									break;
								}
								offset += 8 + size + (size % 2);
							}
						}
						if (!worker || active !== lease || controller.signal.aborted)
							return yield* new AiUnavailable();
						yield* boundary(() =>
							worker
								? worker.invoke("play", [Array.from(pcm)])
								: Promise.reject(new AiUnavailable()),
						);
					}),
				stop: Effect.promise(async () => {
					controller.abort();
					await worker?.close();
					if (active === lease) active = undefined;
				}),
			};
			active = lease;
			return lease;
		}),
	};
}
export const desktopSpeechPorts = () =>
	Layer.mergeAll(
		Layer.succeed(SpeechHttp, { fetch: (url, init) => fetch(url, init) }),
		Layer.succeed(SpeechWebSocket, desktopWebSocket),
		Layer.succeed(SpeechOutput, createDesktopAudioOutput()),
	);
