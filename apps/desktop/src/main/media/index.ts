import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Fiber, Layer, ManagedRuntime, Option } from "effect";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { MediaUnreadable } from "../../renderer/src/wallpaper/display";
import {
	WALLPAPER_CLOCK,
	WALLPAPER_REQUEST,
	WALLPAPER_SNAPSHOT,
	type WallpaperReply,
} from "../../renderer/src/wallpaper/wallpaper-contracts";
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

app.on("ready", () => {
	const runtime = ManagedRuntime.make(
		MediaRepository.Default.pipe(
			Layer.provide(
				Layer.succeed(MediaRoot, join(app.getPath("userData"), "wallpaper-v1")),
			),
		),
	);
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
	const stopClock = (): void => {
		generation++;
		if (clockFiber) {
			void Effect.runPromise(Fiber.interrupt(clockFiber));
			clockFiber = undefined;
		}
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
	const onWindow = (_event: Electron.Event, window: BrowserWindow): void => {
		void startClock();
		window.once("closed", () => {
			if (!BrowserWindow.getAllWindows().length) stopClock();
		});
	};
	app.on("browser-window-created", onWindow);
	void startClock();
	ipcMain.handle(
		WALLPAPER_REQUEST,
		async (event, input: unknown): Promise<WallpaperReply> => {
			// The bridge accepts commands only from this app's top-level windows.
			if (
				!BrowserWindow.fromWebContents(event.sender) ||
				event.senderFrame !== event.sender.mainFrame ||
				!canRequestWallpaper(
					event.sender.getURL(),
					process.env.ELECTRON_RENDERER_URL ??
						pathToFileURL(join(import.meta.dirname, "../renderer/index.html"))
							.href,
					input,
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
	app.once("before-quit", () => {
		ipcMain.removeHandler(WALLPAPER_REQUEST);
		app.removeListener("browser-window-created", onWindow);
		disposed = true;
		stopClock();
		void runtime.dispose();
	});
});
