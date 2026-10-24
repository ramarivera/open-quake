import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Effect, Either, Option, Schema } from "effect";
import {
	BrowserWindow,
	desktopCapturer,
	ipcMain,
	systemPreferences,
} from "electron";
import type { HardwareSession } from "../../../../../packages/device/src/hardware/hardware-service";
import type { MeetingConfig } from "../../../../../packages/edge/src/meetings/meeting-contracts";
import {
	isMeetingError,
	meetingError,
} from "../../../../../packages/edge/src/meetings/meeting-errors";
import type { CapturePort } from "../../../../../packages/edge/src/meetings/meeting-ports";
import {
	CAPTURE_READY,
	CAPTURE_REPLY,
	CAPTURE_REQUEST,
	CaptureReply,
	type CaptureRequest,
} from "../../shared/meeting-bridge";
import { audioFiles } from "./audio-files";

export function createCapturePort(options: {
	root: string;
	renderer: string;
	ffmpeg: string;
	hardware: () => HardwareSession | undefined;
	mock: boolean;
	onLost: (id: string) => void;
}) {
	let window: BrowserWindow | undefined;
	let allowSystem = false;
	const active = new Set<string>();
	const pending = new Map<
		string,
		{ resolve: () => void; reject: (cause: unknown) => void }
	>();
	const files = audioFiles(options.root, options.ffmpeg);
	const listener = (event: Electron.IpcMainEvent, value: unknown): void => {
		if (
			!window ||
			event.sender !== window.webContents ||
			event.senderFrame !== window.webContents.mainFrame
		)
			return;
		const decoded = Schema.decodeUnknownEither(CaptureReply)(value);
		if (Either.isLeft(decoded)) return;
		const task = pending.get(decoded.right.requestId);
		if (decoded.right.success) task?.resolve();
		else task?.reject(meetingError("CaptureFailed"));
	};
	ipcMain.on(CAPTURE_REPLY, listener);
	const ensureWindow = async (): Promise<BrowserWindow> => {
		if (window && !window.isDestroyed()) return window;
		window = new BrowserWindow({
			show: false,
			webPreferences: {
				preload: join(import.meta.dirname, "../preload/index.mjs"),
				sandbox: false,
				nodeIntegration: false,
				contextIsolation: true,
				partition: "meetings-capture",
			},
		});
		const host = window;
		const session = host.webContents.session;
		session.setPermissionCheckHandler(
			(contents, permission) =>
				contents === host.webContents && permission === "media",
		);
		session.setPermissionRequestHandler((contents, permission, callback) =>
			callback(contents === host.webContents && permission === "media"),
		);
		session.setDisplayMediaRequestHandler(async (request, callback) => {
			if (
				!allowSystem ||
				request.frame !== host.webContents.mainFrame ||
				(process.platform === "darwin" &&
					systemPreferences.getMediaAccessStatus("screen") !== "granted")
			) {
				callback({});
				return;
			}
			try {
				const sources = await desktopCapturer.getSources({ types: ["screen"] });
				const source = sources[0];
				callback(source ? { video: source, audio: "loopback" } : {});
			} catch {
				callback({});
			}
		});
		host.webContents.on("render-process-gone", () => {
			for (const task of pending.values())
				task.reject(meetingError("SourceLost"));
			for (const id of active) options.onLost(id);
		});
		const captureReady = new Promise<void>((resolve, reject) => {
			const listener = (event: Electron.IpcMainEvent): void => {
				if (
					event.sender !== host.webContents ||
					event.senderFrame !== host.webContents.mainFrame
				)
					return;
				clearTimeout(timer);
				ipcMain.removeListener(CAPTURE_READY, listener);
				resolve();
			};
			const timer = setTimeout(() => {
				ipcMain.removeListener(CAPTURE_READY, listener);
				reject(meetingError("Timeout"));
			}, 10000);
			ipcMain.on(CAPTURE_READY, listener);
		});
		await Promise.all([
			host.loadURL(
				`${options.renderer}${options.renderer.includes("?") ? "&" : "?"}surface=meeting-capture`,
			),
			captureReady,
		]);
		return host;
	};
	const send = (
		operation: CaptureRequest["operation"],
		id: string,
		config: MeetingConfig,
		parentId?: string,
	) =>
		Effect.tryPromise({
			try: async (signal) => {
				if (options.mock) return;
				const host = await ensureWindow();
				const requestId = randomUUID();
				allowSystem = config.systemAudio || operation === "translate";
				await new Promise<void>((resolve, reject) => {
					const cleanup = () => {
						pending.delete(requestId);
						clearTimeout(timer);
						signal.removeEventListener("abort", abort);
					};
					const finish = () => {
						cleanup();
						resolve();
					};
					const fail = (cause: unknown) => {
						allowSystem = false;
						if (
							(operation === "start" || operation === "translate") &&
							!host.isDestroyed()
						)
							host.webContents.send(CAPTURE_REQUEST, {
								requestId: randomUUID(),
								operation: operation === "start" ? "cancel" : "stopTranslation",
								id,
								microphoneId: config.microphoneId,
								systemAudio: false,
							} satisfies CaptureRequest);
						cleanup();
						reject(cause);
					};
					const abort = () => fail(meetingError("CaptureFailed"));
					const timer = setTimeout(() => fail(meetingError("Timeout")), 30000);
					pending.set(requestId, { resolve: finish, reject: fail });
					signal.addEventListener("abort", abort, { once: true });
					host.webContents.send(CAPTURE_REQUEST, {
						requestId,
						operation,
						id,
						...(parentId ? { parentId } : {}),
						microphoneId: config.microphoneId,
						systemAudio: config.systemAudio,
					} satisfies CaptureRequest);
				});
				allowSystem = false;
			},
			catch: (cause) =>
				isMeetingError(cause) ? cause : meetingError("CaptureFailed", cause),
		});
	let lastConfig: MeetingConfig;
	const port: CapturePort = {
		mic: () => {
			const hardware = options.hardware();
			return hardware
				? hardware
						.snapshot()
						.pipe(Effect.map((snapshot) => Option.fromNullable(snapshot.mic)))
				: Effect.succeed(Option.none());
		},
		start: (id, config, parent) =>
			Effect.gen(function* () {
				if (!options.mock && !parent && process.platform === "darwin") {
					const granted = yield* Effect.tryPromise({
						try: () => systemPreferences.askForMediaAccess("microphone"),
						catch: (cause) => meetingError("CaptureDenied", cause),
					});
					if (
						!granted ||
						(config.systemAudio &&
							systemPreferences.getMediaAccessStatus("screen") !== "granted")
					)
						return yield* meetingError("CaptureDenied");
				}
				yield* send("start", id, config, parent);
				lastConfig = config;
				active.add(id);
			}),
		stop: (id) =>
			Effect.gen(function* () {
				if (active.has(id)) yield* send("stop", id, lastConfig);
				if (!options.mock) yield* files.finalize(id);
				active.delete(id);
			}),
		cancel: (id) =>
			Effect.gen(function* () {
				if (!active.has(id)) return;
				yield* send("cancel", id, lastConfig).pipe(Effect.ignore);
				active.delete(id);
			}),
		startTranslation: (config) =>
			Effect.gen(function* () {
				if (
					!options.mock &&
					process.platform === "darwin" &&
					systemPreferences.getMediaAccessStatus("screen") !== "granted"
				)
					return yield* meetingError("CaptureDenied");
				lastConfig = config;
				yield* send(
					"translate",
					"00000000-0000-4000-8000-000000000000",
					config,
				);
			}),
		stopTranslation: () =>
			lastConfig
				? send(
						"stopTranslation",
						"00000000-0000-4000-8000-000000000000",
						lastConfig,
					).pipe(Effect.ignore)
				: Effect.void,
		toggleMic: () => {
			const hardware = options.hardware();
			return hardware
				? hardware.toggleMic().pipe(
						Effect.mapError((cause) => meetingError("Unavailable", cause)),
						Effect.asVoid,
					)
				: Effect.fail(meetingError("Unavailable"));
		},
	};
	return {
		port,
		files,
		accepts: (event: Electron.IpcMainInvokeEvent) =>
			!!window &&
			event.sender === window.webContents &&
			event.senderFrame === window.webContents.mainFrame,
		active: (id: string) => active.has(id),
		dispose: () => {
			ipcMain.removeListener(CAPTURE_REPLY, listener);
			for (const task of pending.values())
				task.reject(meetingError("CaptureFailed"));
			pending.clear();
			if (window && !window.isDestroyed()) window.destroy();
			window = undefined;
		},
	};
}
