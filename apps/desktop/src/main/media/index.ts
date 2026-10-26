import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Fiber, Layer, Option } from "effect";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { MediaUnreadable } from "../../shared/display";
import {
	WALLPAPER_CLOCK,
	WALLPAPER_REQUEST,
	WALLPAPER_SNAPSHOT,
	type WallpaperReply,
} from "../../shared/wallpaper-contracts";
import type { DesktopRuntime } from "../diagnostics/module";
import { makeMediaController } from "./media-controller";
import { MediaRoot } from "./media-files";
import { canRequestWallpaper } from "./media-permissions";
import { MediaRepository } from "./media-repository";

function broadcast(channel: string, value: unknown): Effect.Effect<void> {
	return Effect.sync(() => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed() && !window.webContents.isDestroyed())
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
): { dispose: () => Promise<void>; selectionSerial: () => Promise<string> } {
	const controller = runtime.runPromise(
		makeMediaController({
			chooseImage: Effect.tryPromise({
				try: () =>
					dialog.showOpenDialog({
						title: "Choose wallpaper",
						properties: ["openFile"],
						filters: [
							{ name: "JPEG or PNG", extensions: ["jpg", "jpeg", "png"] },
						],
					}),
				catch: (cause) => new MediaUnreadable(cause),
			}).pipe(
				Effect.map((result) =>
					result.canceled
						? Option.none()
						: Option.fromNullable(result.filePaths[0]),
				),
			),
			publish: (snapshot) => broadcast(WALLPAPER_SNAPSHOT, snapshot),
			publishClock: (clock) => broadcast(WALLPAPER_CLOCK, clock),
		}),
	);
	let clockFiber: Fiber.RuntimeFiber<void> | undefined;
	let generation = 0;
	let disposed = false;
	const stopClock = (): Promise<void> => {
		generation++;
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
	const trackWindow = (window: BrowserWindow): void => {
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
			const service = await controller;
			return runtime.runPromise(
				service.request(input).pipe(
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
		ipcMain.removeHandler(WALLPAPER_REQUEST);
		app.removeListener("browser-window-created", onWindow);
		shutdown = (async () => {
			await stopClock();
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
