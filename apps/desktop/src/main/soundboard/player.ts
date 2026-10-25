import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, Schema } from "effect";
import { app, BrowserWindow, session } from "electron";
import { SoundboardPlayer } from "../../../../../packages/edge/src/soundboard/playback-ports.js";
import type { SoundEntry } from "../../../../../packages/edge/src/soundboard/soundboard-contracts.js";
import { SoundboardDecodeFailed } from "../../../../../packages/edge/src/soundboard/soundboard-errors.js";
import { isLocalSoundPath } from "../../../../../packages/edge/src/soundboard/soundboard-invariants.js";
import { soundboardWorkerSource } from "./player-worker";

type Method = "ready" | "play" | "pause" | "position" | "gain" | "ended";
export interface SoundboardWorker {
	readonly invoke: (
		method: Method,
		args?: readonly number[],
	) => Promise<unknown>;
	readonly close: () => Promise<void>;
}

/** Opens only on an explicit playback request. Never shows, focuses, or requests permission. */
export async function openSoundboardWorker(
	url: string,
	signal: AbortSignal,
): Promise<SoundboardWorker> {
	const directory = await mkdtemp(
		join(app.getPath("sessionData"), "soundboard-worker-"),
	);
	const file = join(directory, "player.html");
	const page = pathToFileURL(file).href;
	let window: BrowserWindow | undefined;
	let closing: Promise<void> | undefined;
	const close = (): Promise<void> => {
		if (closing) return closing;
		signal.removeEventListener("abort", abort);
		if (window && !window.isDestroyed()) window.destroy();
		closing = rm(directory, { recursive: true, force: true });
		return closing;
	};
	const abort = () => {
		void close().catch(() => undefined);
	};
	const check = () => {
		if (signal.aborted || closing) throw new SoundboardDecodeFailed();
	};
	signal.addEventListener("abort", abort, { once: true });
	try {
		check();
		await writeFile(
			file,
			"<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; media-src file:; script-src 'unsafe-eval'\"><title>Local audio player</title>",
			{ mode: 0o600 },
		);
		check();
		const isolated = session.fromPartition(`soundboard-${randomUUID()}`);
		isolated.setPermissionRequestHandler((_contents, _permission, reply) =>
			reply(false),
		);
		isolated.setPermissionCheckHandler(() => false);
		isolated.webRequest.onBeforeRequest((details, reply) =>
			reply({ cancel: details.url !== page && details.url !== url }),
		);
		isolated.on("will-download", (event) => event.preventDefault());
		window = new BrowserWindow({
			show: false,
			focusable: false,
			webPreferences: {
				session: isolated,
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				backgroundThrottling: false,
				autoplayPolicy: "no-user-gesture-required",
			},
		});
		window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		window.webContents.on("will-navigate", (event) => event.preventDefault());
		await window.loadURL(page);
		check();
		await window.webContents.executeJavaScript(soundboardWorkerSource(url));
		check();
		return {
			invoke: async (method, args = []) => {
				check();
				if (
					!window ||
					window.isDestroyed() ||
					!/^(ready|play|pause|position|gain|ended)$/.test(method)
				)
					throw new SoundboardDecodeFailed();
				return window.webContents.executeJavaScript(
					`globalThis.__quakeSoundboard.${method}(...${JSON.stringify(args)})`,
				);
			},
			close,
		};
	} catch (cause) {
		await close();
		throw cause;
	}
}

/** The scope owns cancellation before native acquisition begins, including late results. */
export function createSoundboardPlayer(
	open = openSoundboardWorker,
): typeof SoundboardPlayer.Service {
	return {
		open: Effect.fn("SoundboardPlayer.open")((entry: SoundEntry) =>
			Effect.gen(function* () {
				if (
					!isLocalSoundPath(entry.path) ||
					!isAbsolute(entry.path) ||
					(process.platform === "win32" &&
						!/^[a-zA-Z]:[\\/]/.test(entry.path)) ||
					!entry.path.toLowerCase().endsWith(".mp3")
				)
					return yield* new SoundboardDecodeFailed();
				const controller = new AbortController();
				let worker: SoundboardWorker | undefined;
				yield* Effect.addFinalizer(() =>
					Effect.tryPromise({
						try: async () => {
							controller.abort();
							await worker?.close();
						},
						catch: (cause) => new SoundboardDecodeFailed(cause),
					}).pipe(Effect.orDie),
				);
				worker = yield* Effect.tryPromise({
					try: async (signal) => {
						const cancel = () => controller.abort();
						signal.addEventListener("abort", cancel, { once: true });
						try {
							const result = await open(
								pathToFileURL(entry.path).href,
								controller.signal,
							);
							if (controller.signal.aborted) {
								await result.close();
								throw new SoundboardDecodeFailed();
							}
							worker = result;
							return result;
						} finally {
							signal.removeEventListener("abort", cancel);
						}
					},
					catch: (cause) =>
						cause instanceof SoundboardDecodeFailed
							? cause
							: new SoundboardDecodeFailed(cause),
				}).pipe(Effect.onError(() => Effect.sync(() => controller.abort())));
				const native = worker;
				const invoke = (method: Method, args?: readonly number[]) =>
					Effect.tryPromise({
						try: () => native.invoke(method, args),
						catch: (cause) =>
							cause instanceof SoundboardDecodeFailed
								? cause
								: new SoundboardDecodeFailed(cause),
					});
				return {
					ready: invoke("ready").pipe(Effect.asVoid),
					play: invoke("play").pipe(Effect.asVoid),
					pause: invoke("pause").pipe(Effect.asVoid),
					position: invoke("position").pipe(
						Effect.flatMap(
							Schema.decodeUnknown(
								Schema.Number.pipe(Schema.finite(), Schema.nonNegative()),
							),
						),
						Effect.mapError((cause) =>
							cause instanceof SoundboardDecodeFailed
								? cause
								: new SoundboardDecodeFailed(cause),
						),
					),
					gain: (gain: number) =>
						Number.isFinite(gain) && gain >= 0 && gain <= 1
							? invoke("gain", [gain]).pipe(Effect.asVoid)
							: Effect.fail(new SoundboardDecodeFailed()),
					ended: invoke("ended").pipe(Effect.asVoid),
				};
			}),
		),
	};
}

export const SoundboardPlayerLive = Layer.succeed(
	SoundboardPlayer,
	createSoundboardPlayer(),
);
