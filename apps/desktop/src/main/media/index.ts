import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Fiber, Layer, Option, Schema } from "effect";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { AudioOutputLease } from "../../../../../packages/edge/src/audio/output-service";
import { MediaUnreadable } from "../../shared/display";
import {
	WALLPAPER_AUDIO,
	WALLPAPER_CLOCK,
	WALLPAPER_REQUEST,
	WALLPAPER_SNAPSHOT,
	WallpaperAudioCommand,
	type WallpaperReply,
	type WallpaperSnapshot,
} from "../../shared/wallpaper-contracts";
import type { DesktopRuntime } from "../diagnostics/module";
import { type MediaController, makeMediaController } from "./media-controller";
import { MediaRoot } from "./media-files";
import { canRequestWallpaper } from "./media-permissions";
import { MediaRepository } from "./media-repository";
import { wallpaperAudioSession } from "./wallpaper-audio";

function broadcast(
	channel: string,
	value: unknown,
	accepts: (window: BrowserWindow) => boolean = () => true,
): Effect.Effect<void> {
	return Effect.sync(() => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (
				!window.isDestroyed() &&
				!window.webContents.isDestroyed() &&
				accepts(window)
			)
				window.webContents.send(channel, value);
		}
	});
}

export const MediaLive = (root: string): Layer.Layer<MediaRepository> =>
	MediaRepository.Default.pipe(Layer.provide(Layer.succeed(MediaRoot, root)));

/** Main owns the runtime and identifies its management window independently of URLs. */
export function registerMedia(
	runtime: DesktopRuntime<MediaRepository, never>,
	managementWindow: () => BrowserWindow | undefined,
	renderer = process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href,
	quitOwner = true,
	panelWindow: () => BrowserWindow | undefined = () => undefined,
	acquireSound: (
		mute: () => Promise<void>,
	) => Promise<AudioOutputLease | undefined> = async () => undefined,
	panelSerial: (sender: Electron.WebContents) => string | undefined = () =>
		undefined,
	applyBackground: (snapshot: WallpaperSnapshot) => void = () => {},
): { dispose: () => Promise<void>; selectionSerial: () => Promise<string> } {
	const audio = wallpaperAudioSession(acquireSound);
	let audioEpoch = 0;
	let audioKey = "";
	let audioSender: Electron.WebContents | undefined;
	let audioRequest: { id: string } | undefined;
	ipcMain.handle(
		WALLPAPER_AUDIO,
		async (event, input: unknown): Promise<boolean> => {
			if (
				event.sender !== panelWindow()?.webContents ||
				event.senderFrame !== event.sender.mainFrame ||
				!canRequestWallpaper(
					event.sender.getURL(),
					renderer,
					{ _tag: "read" },
					false,
				) ||
				!Schema.is(WallpaperAudioCommand)(input)
			)
				return false;
			if (input.active && (disposed || !panelWindow()?.isVisible()))
				return false;
			if (!input.active) {
				if (audioRequest?.id === input.id) audioRequest = undefined;
				await audio.stop(input.id);
				return false;
			}
			const request = { id: input.id };
			audioRequest = request;
			const service = await controllerFor(panelSerial(event.sender));
			const snapshot = await runtime.runPromise(
				service.request({ _tag: "read" }),
			);
			const media =
				snapshot.saved.settings.displayMediaList[snapshot.activeIndex ?? 0];
			if (
				audioRequest !== request ||
				!panelWindow()?.isVisible() ||
				!snapshot.saved.settings.enableSound ||
				snapshot.saved.serial !== input.serial ||
				snapshot.saved.revision !== input.revision ||
				media?.type !== "video"
			)
				return false;
			const expectedEpoch = audioEpoch;
			audioSender = event.sender;
			return audio.start(
				input.id,
				async () => {
					if (!event.sender.isDestroyed()) event.sender.setAudioMuted(true);
				},
				() => {
					if (
						!event.sender.isDestroyed() &&
						process.env.OPEN_QUAKE_MOCK_DEVICE !== "1"
					)
						event.sender.setAudioMuted(false);
				},
				() =>
					audioRequest === request &&
					expectedEpoch === audioEpoch &&
					!disposed &&
					!event.sender.isDestroyed() &&
					event.sender === panelWindow()?.webContents &&
					panelWindow()?.isVisible() === true,
			);
		},
	);
	const scopedControllers = new Map<string, Promise<MediaController>>();
	const scopedClocks = new Map<string, Fiber.RuntimeFiber<void>>();
	const panelReaders = new Map<Electron.WebContents, string>();
	const chooseImages = Effect.tryPromise({
		try: () =>
			dialog.showOpenDialog({
				title: "Choose wallpaper",
				properties: ["openFile", "multiSelections"],
				filters: [
					{
						name: "Wallpaper media",
						extensions: [
							"jpg",
							"jpeg",
							"png",
							"gif",
							"mp4",
							"mov",
							"mkv",
							"webm",
							"avi",
						],
					},
				],
			}),
		catch: (cause) => new MediaUnreadable(cause),
	}).pipe(Effect.map((result) => (result.canceled ? [] : result.filePaths)));
	const makeController = (serial?: string) =>
		runtime.runPromise(
			makeMediaController({
				chooseImages,
				chooseImage: chooseImages.pipe(
					Effect.map((paths) => Option.fromNullable(paths[0])),
				),
				publish: (snapshot) =>
					Effect.gen(function* () {
						yield* Effect.sync(() => applyBackground(snapshot));
						const key = JSON.stringify([
							snapshot.saved.serial,
							snapshot.saved.revision,
							snapshot.saved.settings.enableSound,
							snapshot.activeIndex,
							snapshot.playbackId,
							snapshot.asset._tag,
						]);
						const soundPanel = audioSender ? panelWindow() : undefined;
						if (
							serial ===
								(soundPanel && !soundPanel.isDestroyed()
									? panelSerial(soundPanel.webContents)
									: undefined) &&
							key !== audioKey
						) {
							audioKey = key;
							audioEpoch++;
							yield* Effect.promise(() => audio.stop());
						}
						yield* broadcast(
							WALLPAPER_SNAPSHOT,
							snapshot,
							(window) => panelSerial(window.webContents) === serial,
						);
					}),
				publishClock: (clock) =>
					broadcast(
						WALLPAPER_CLOCK,
						clock,
						(window) => panelSerial(window.webContents) === serial,
					),
			}).pipe(
				Effect.tap((service) =>
					serial === undefined
						? Effect.void
						: service.request({ _tag: "select", serial }).pipe(Effect.asVoid),
				),
			),
		);
	const controller = makeController();
	const controllerFor = (serial?: string): Promise<MediaController> => {
		if (serial === undefined) return controller;
		let pending = scopedControllers.get(serial);
		if (!pending) {
			pending = makeController(serial);
			scopedControllers.set(serial, pending);
			void pending.catch(() => {
				if (scopedControllers.get(serial) === pending)
					scopedControllers.delete(serial);
			});
		}
		return pending.then((service) => {
			if (
				!disposed &&
				scopedControllers.get(serial) === pending &&
				!scopedClocks.has(serial) &&
				BrowserWindow.getAllWindows().some(
					(window) =>
						!window.isDestroyed() && panelSerial(window.webContents) === serial,
				)
			)
				scopedClocks.set(serial, runtime.runFork(service.ticks));
			return service;
		});
	};
	let clockFiber: Fiber.RuntimeFiber<void> | undefined;
	let generation = 0;
	let disposed = false;
	const stopClock = async (): Promise<void> => {
		generation++;
		for (const fiber of scopedClocks.values())
			await runtime.runPromise(Fiber.interrupt(fiber));
		scopedClocks.clear();
		if (clockFiber) {
			const fiber = clockFiber;
			clockFiber = undefined;
			return runtime.runPromise(Fiber.interrupt(fiber)).then(() => undefined);
		}
		return Promise.resolve();
	};
	const startClock = async (): Promise<void> => {
		const current = generation;
		const service = await controller;
		if (
			!disposed &&
			current === generation &&
			!clockFiber &&
			BrowserWindow.getAllWindows().length
		)
			clockFiber = runtime.runFork(service.ticks);
	};
	const removeVisibilityListeners = new Set<() => void>();
	const trackWindow = (window: BrowserWindow): void => {
		const contents = window.webContents;
		const deactivate = (): void => {
			if (audioSender === contents || window === panelWindow()) {
				audioEpoch++;
				audioSender = undefined;
				audioRequest = undefined;
				if (!contents.isDestroyed()) contents.setAudioMuted(true);
				void audio.stop();
			}
		};
		const remove = (): void => {
			window.removeListener("hide", deactivate);
			window.removeListener("closed", onClosed);
			removeVisibilityListeners.delete(remove);
		};
		const onClosed = (): void => {
			deactivate();
			remove();
			const serial = panelReaders.get(contents);
			panelReaders.delete(contents);
			if (
				serial !== undefined &&
				![...panelReaders.values()].includes(serial)
			) {
				scopedControllers.delete(serial);
				const fiber = scopedClocks.get(serial);
				scopedClocks.delete(serial);
				if (fiber) void runtime.runPromise(Fiber.interrupt(fiber));
			}
		};
		window.on("hide", deactivate);
		window.once("closed", onClosed);
		removeVisibilityListeners.add(remove);
		void startClock();
		window.once("closed", () => {
			if (!BrowserWindow.getAllWindows().length) void stopClock();
		});
	};
	const onWindow = (_event: Electron.Event, window: BrowserWindow): void =>
		trackWindow(window);
	app.on("browser-window-created", onWindow);
	for (const window of BrowserWindow.getAllWindows()) trackWindow(window);
	ipcMain.handle(
		WALLPAPER_REQUEST,
		async (event, input: unknown): Promise<WallpaperReply> => {
			// The bridge accepts commands only from this app's top-level windows.
			if (
				!BrowserWindow.fromWebContents(event.sender) ||
				event.senderFrame !== event.sender.mainFrame ||
				!canRequestWallpaper(
					event.sender.getURL(),
					renderer,
					input,
					event.sender === managementWindow()?.webContents,
				)
			)
				return {
					_tag: "failure",
					code: "QUAKE.DISPLAY.INVALID_WALLPAPER",
					message: "Wallpaper request was rejected",
				};
			const serial = panelSerial(event.sender);

			if (
				typeof input === "object" &&
				input !== null &&
				"_tag" in input &&
				input._tag === "failed" &&
				(serial === undefined ||
					!("serial" in input) ||
					input.serial !== serial)
			)
				return {
					_tag: "failure",
					code: "QUAKE.DISPLAY.INVALID_WALLPAPER",
					message: "Wallpaper request was rejected",
				};
			if (serial !== undefined) panelReaders.set(event.sender, serial);
			const service = await controllerFor(serial);
			return runtime.runPromise(
				service.request(input).pipe(
					Effect.tap((snapshot) => {
						const pinned =
							serial === undefined
								? scopedControllers.get(snapshot.saved.serial)
								: undefined;
						return pinned
							? Effect.promise(() => pinned).pipe(
									Effect.flatMap((owner) => owner.request({ _tag: "read" })),
									Effect.asVoid,
								)
							: Effect.void;
					}),
					Effect.map(
						(snapshot): WallpaperReply => ({ _tag: "success", snapshot }),
					),
					Effect.catchTags({
						InvalidWallpaper: (error) =>
							Effect.succeed({
								_tag: "failure" as const,
								code: error.code,
								message: error.message,
							}),
						MediaUnreadable: (error) =>
							Effect.succeed({
								_tag: "failure" as const,
								code: error.code,
								message: error.message,
							}),
						MediaPersistenceFailed: (error) =>
							Effect.succeed({
								_tag: "failure" as const,
								code: error.code,
								message: error.message,
							}),
					}),
				),
			);
		},
	);
	let shutdown: Promise<void> | undefined;
	const dispose = (): Promise<void> => {
		if (shutdown) return shutdown;
		disposed = true;
		for (const remove of removeVisibilityListeners) remove();
		ipcMain.removeHandler(WALLPAPER_REQUEST);
		ipcMain.removeHandler(WALLPAPER_AUDIO);
		app.removeListener("browser-window-created", onWindow);
		shutdown = (async () => {
			await stopClock();
			await audio.close();
			await controller;
			await runtime.dispose();
			app.removeListener("before-quit", onBeforeQuit);
		})();
		return shutdown;
	};
	let quitting = false;
	const onBeforeQuit = (event: Electron.Event): void => {
		event.preventDefault();
		if (!quitting) {
			quitting = true;
			void dispose().then(() => app.quit());
		}
	};
	if (quitOwner) app.on("before-quit", onBeforeQuit);
	return {
		dispose,
		selectionSerial: async () =>
			runtime.runPromise((await controller).selectionSerial),
	};
}
