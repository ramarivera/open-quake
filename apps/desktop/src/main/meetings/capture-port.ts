import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Effect, Either, Option, Schema } from "effect";
import {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
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
import type { MicrophoneIdentity } from "../../shared/speech";
import { audioFiles } from "./audio-files";

class SystemAudioUnavailable extends Error {}

export function createCapturePort(options: {
	root: string;
	renderer: string;
	ffmpeg: string;
	hardware: () => HardwareSession | undefined;
	mock: boolean;
	microphone?:
		| (() => Effect.Effect<MicrophoneIdentity | undefined>)
		| undefined;
	managementId?: (() => number | undefined) | undefined;
	onLost: (id: string) => void;
	onNoWindows: () => void;
}) {
	let window: BrowserWindow | undefined;
	let allowSystem = false;
	let translating = false;
	const translationId = "00000000-0000-4000-8000-000000000000";
	const captureURL = new URL(options.renderer);
	captureURL.searchParams.set("surface", "meeting-capture");
	const trusted = (host: BrowserWindow): boolean =>
		!host.isDestroyed() &&
		host.webContents.getURL() === captureURL.href &&
		host.webContents.mainFrame.url === captureURL.href;
	const releaseIdle = (): void => {
		if (active.size || translating || pending.size) return;
		const host = window;
		window = undefined;
		if (host && !host.isDestroyed()) host.destroy();
	};
	const observed = new WeakSet<BrowserWindow>();
	const observeUserWindow = (user: BrowserWindow): void => {
		if (observed.has(user)) return;
		observed.add(user);
		user.once("closed", () => {
			if (
				window &&
				BrowserWindow.getAllWindows().every((win) => win === window)
			)
				options.onNoWindows();
		});
	};
	const windowCreated = (_event: Electron.Event, user: BrowserWindow) =>
		observeUserWindow(user);
	app.on("browser-window-created", windowCreated);
	const active = new Set<string>();
	const pending = new Map<
		string,
		{ resolve: () => void; reject: (cause: unknown) => void }
	>();
	const files = audioFiles(options.root, options.ffmpeg);
	const listener = (event: Electron.IpcMainEvent, value: unknown): void => {
		if (
			!window ||
			!trusted(window) ||
			event.sender !== window.webContents ||
			event.senderFrame !== window.webContents.mainFrame
		)
			return;
		const decoded = Schema.decodeUnknownEither(CaptureReply)(value);
		if (Either.isLeft(decoded)) return;
		const task = pending.get(decoded.right.requestId);
		if (decoded.right.success) task?.resolve();
		else
			task?.reject(
				decoded.right.reason === "systemUnavailable"
					? meetingError("CaptureFailed", new SystemAudioUnavailable())
					: meetingError("CaptureFailed"),
			);
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
		for (const user of BrowserWindow.getAllWindows())
			if (user !== host) observeUserWindow(user);
		session.setPermissionCheckHandler(
			(contents, permission, _origin, details) =>
				contents === host.webContents &&
				trusted(host) &&
				permission === "media" &&
				details.isMainFrame &&
				details.requestingUrl === captureURL.href &&
				details.mediaType === "audio",
		);
		session.setPermissionRequestHandler(
			(contents, permission, callback, details) =>
				callback(
					contents === host.webContents &&
						trusted(host) &&
						permission === "media" &&
						details.isMainFrame &&
						details.requestingUrl === captureURL.href &&
						"mediaTypes" in details &&
						details.mediaTypes.every((type) => type === "audio"),
				),
		);
		host.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		host.webContents.on("will-navigate", (event) => event.preventDefault());
		host.webContents.on("will-redirect", (event) => event.preventDefault());
		session.setDisplayMediaRequestHandler(async (request, callback) => {
			if (
				!trusted(host) ||
				!allowSystem ||
				process.platform !== "win32" ||
				request.frame !== host.webContents.mainFrame
			) {
				callback({});
				return;
			}
			try {
				const sources = await desktopCapturer.getSources({ types: ["screen"] });
				const source = sources[0];
				callback(
					trusted(host) && allowSystem && source
						? { video: source, audio: "loopback" }
						: {},
				);
			} catch {
				callback({});
			}
		});
		const lost = (): void => {
			const ids = [...active, ...(translating ? [translationId] : [])];
			active.clear();
			translating = false;
			allowSystem = false;
			if (window === host) window = undefined;
			if (!host.isDestroyed()) host.destroy();
			for (const task of [...pending.values()])
				task.reject(meetingError("SourceLost"));
			for (const id of ids) options.onLost(id);
		};
		host.webContents.on("render-process-gone", lost);
		let loaded = false;
		host.webContents.on(
			"did-start-navigation",
			(_event, _url, inPlace, mainFrame) => {
				if (loaded && mainFrame && !inPlace) lost();
			},
		);
		const captureReady = new Promise<void>((resolve, reject) => {
			const listener = (event: Electron.IpcMainEvent): void => {
				if (
					!trusted(host) ||
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
		await Promise.all([host.loadURL(captureURL.href), captureReady]);
		if (!trusted(host)) {
			lost();
			throw meetingError("CaptureFailed");
		}
		loaded = true;
		return host;
	};
	const send = (
		operation: CaptureRequest["operation"],
		id: string,
		config: MeetingConfig,
		parentId?: string,
	) =>
		Effect.gen(function* () {
			const microphone = options.microphone
				? ((yield* options.microphone()) ?? {
						deviceId: "default",
						label: "",
						groupId: "",
					})
				: undefined;
			return yield* Effect.tryPromise({
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
									operation:
										operation === "start" ? "cancel" : "stopTranslation",
									id,
									microphoneId: microphone?.deviceId ?? config.microphoneId,
									...(microphone ? { microphone } : {}),
									platform:
										process.platform === "win32"
											? "win32"
											: process.platform === "darwin"
												? "darwin"
												: "linux",
									systemAudio: false,
								} satisfies CaptureRequest);
							cleanup();
							reject(cause);
						};
						const abort = () => fail(meetingError("CaptureFailed"));
						const timer = setTimeout(
							() => fail(meetingError("Timeout")),
							30000,
						);
						pending.set(requestId, { resolve: finish, reject: fail });
						signal.addEventListener("abort", abort, { once: true });
						host.webContents.send(CAPTURE_REQUEST, {
							requestId,
							operation,
							id,
							...(parentId ? { parentId } : {}),
							microphoneId: microphone?.deviceId ?? config.microphoneId,
							...(microphone ? { microphone } : {}),
							platform:
								process.platform === "win32"
									? "win32"
									: process.platform === "darwin"
										? "darwin"
										: "linux",
							systemAudio: config.systemAudio,
						} satisfies CaptureRequest);
					});
					allowSystem = false;
				},
				catch: (cause) =>
					isMeetingError(cause) ? cause : meetingError("CaptureFailed", cause),
			});
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
				if (!options.mock) yield* files.ready();
				if (!options.mock && !parent && process.platform === "darwin") {
					const granted = yield* Effect.tryPromise({
						try: () => systemPreferences.askForMediaAccess("microphone"),
						catch: (cause) => meetingError("CaptureDenied", cause),
					});
					if (!granted) return yield* meetingError("CaptureDenied");
				}
				lastConfig = config;
				active.add(id);
				yield* send("start", id, config, parent).pipe(
					Effect.catchIf(
						(cause) => cause.originalCause instanceof SystemAudioUnavailable,
						() =>
							Effect.gen(function* () {
								const ownerId = options.managementId?.();
								const owner = BrowserWindow.getAllWindows().find(
									(win) => !win.isDestroyed() && win.webContents.id === ownerId,
								);
								// On macOS an unparented alert runs a native modal loop and
								// stops JS timers, IPC and even the abort signal.
								if (!owner) {
									yield* Effect.logWarning(
										"Meeting fallback has no management window",
									).pipe(
										Effect.annotateLogs("code", "QUAKE.MEETING.CAPTURE_FAILED"),
									);
									return yield* meetingError("CaptureFailed");
								}
								const choice = yield* Effect.tryPromise({
									try: (signal) =>
										dialog.showMessageBox(owner, {
											signal,
											type: "question",
											message: "System audio is unavailable",
											detail:
												"Record with the selected microphone only, or cancel and check System audio setup in meeting settings.",
											buttons: ["Microphone only", "Cancel"],
											defaultId: 1,
											cancelId: 1,
										}),
									catch: (cause) => meetingError("CaptureFailed", cause),
								}).pipe(
									Effect.timeoutFail({
										duration: "60 seconds",
										onTimeout: () => meetingError("Timeout"),
									}),
								);
								if (choice.response !== 0)
									return yield* meetingError("CaptureFailed");
								lastConfig = { ...config, systemAudio: false };
								yield* send("start", id, lastConfig, parent).pipe(
									Effect.mapError((cause) =>
										isMeetingError(cause)
											? cause
											: meetingError("CaptureFailed", cause),
									),
								);
							}),
					),
					Effect.onError(() =>
						Effect.sync(() => {
							active.delete(id);
							releaseIdle();
						}),
					),
				);
				return lastConfig;
			}),
		drain: (id) =>
			Effect.gen(function* () {
				if (!active.has(id)) return;
				yield* send("stop", id, lastConfig).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							active.delete(id);
							releaseIdle();
						}),
					),
				);
			}),
		duration: (id) => (options.mock ? Effect.succeed(0) : files.duration(id)),
		stop: (id) =>
			Effect.gen(function* () {
				yield* port.drain(id);
				if (!options.mock) yield* files.finalize(id);
			}),
		cancel: (id) =>
			Effect.gen(function* () {
				if (!active.has(id)) return;
				yield* send("cancel", id, lastConfig).pipe(Effect.ignore);
				active.delete(id);
				releaseIdle();
			}),
		startTranslation: (config) =>
			Effect.gen(function* () {
				lastConfig = config;
				yield* send("translate", translationId, config);
				translating = true;
			}),
		stopTranslation: () =>
			Effect.gen(function* () {
				if (translating && lastConfig && window)
					yield* send("stopTranslation", translationId, lastConfig).pipe(
						Effect.ignore,
					);
				translating = false;
				releaseIdle();
			}),
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
			trusted(window) &&
			event.sender === window.webContents &&
			event.senderFrame === window.webContents.mainFrame,
		active: (id: string) => active.has(id),
		dispose: () => {
			app.removeListener("browser-window-created", windowCreated);
			ipcMain.removeListener(CAPTURE_REPLY, listener);
			for (const task of pending.values())
				task.reject(meetingError("CaptureFailed"));
			pending.clear();
			if (window && !window.isDestroyed()) window.destroy();
			window = undefined;
		},
	};
}
