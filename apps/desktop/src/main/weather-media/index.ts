import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Layer, Schema } from "effect";
import { BrowserWindow, ipcMain, nativeImage } from "electron";
import {
	WEATHER_MEDIA_CHANGED,
	WEATHER_MEDIA_REQUEST,
	WeatherMediaCommand,
	type WeatherMediaReply,
} from "../../shared/weather-media-contracts";
import { canRequestClock } from "../clock/clock-ipc";
import type { DesktopRuntime } from "../diagnostics/module";
import { WeatherMediaController } from "./controller";
import { nativeSystemMedia } from "./native";
import { boundedCoverBytes } from "./native/cover";
import { weatherSettingsLive } from "./settings-repository";
import { SystemMediaService } from "./system-media";
import { weatherNetworkLive } from "./weather-network";
import { WeatherService } from "./weather-service";

export const weatherMediaLive = (root: string, platform: string) => {
	const directory = import.meta.dirname.includes("app.asar/")
		? join(process.resourcesPath, "app.asar.unpacked/out/native-media")
		: join(import.meta.dirname, "../native-media");
	const media = SystemMediaService.Default.pipe(
		Layer.provide(
			nativeSystemMedia({
				platform,
				directory,
				enabled: process.env.OPEN_QUAKE_MOCK_DEVICE !== "1",
				cover: (base64, mime) => {
					const bytes = boundedCoverBytes(base64, mime);
					if (!bytes) return null;
					try {
						const image = nativeImage.createFromBuffer(bytes);
						const size = image.getSize();
						if (image.isEmpty() || size.width * size.height > 16_000_000)
							return null;
						const data = image
							.resize({ width: Math.min(512, size.width) })
							.toDataURL();
						return data.length <= 3_000_000 ? data : null;
					} catch {
						// Corrupt optional artwork must not discard an otherwise valid session.
						return null;
					}
				},
			}),
		),
	);
	return WeatherMediaController.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(media),
		Layer.provide(WeatherService.Default),
		Layer.provide(
			Layer.mergeAll(weatherSettingsLive(root), weatherNetworkLive),
		),
	);
};

export const canRequestWeatherMedia = (
	caller: string,
	renderer: string,
	input: unknown,
	management: boolean,
): boolean => {
	if (
		!canRequestClock(caller, renderer, { _tag: "read" }, false) ||
		!Schema.is(WeatherMediaCommand)(input)
	)
		return false;
	return (
		management || (input._tag !== "configure" && input._tag !== "verifyCity")
	);
};

export function registerWeatherMedia(
	runtime: DesktopRuntime<WeatherMediaController, never>,
	managementWindow: () => BrowserWindow | undefined,
	renderer = process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href,
): { dispose: () => Promise<void> } {
	let disposed = false;
	let shutdown: Promise<void> | undefined;
	const pending = new Set<Promise<unknown>>();
	const track = <A>(operation: Promise<A>): Promise<A> => {
		pending.add(operation);
		void operation.then(
			() => pending.delete(operation),
			() => pending.delete(operation),
		);
		return operation;
	};
	const broadcast = async (): Promise<void> => {
		if (disposed) return;
		const snapshot = await runtime.runPromise(WeatherMediaController.read());
		if (disposed) return;
		for (const window of BrowserWindow.getAllWindows())
			if (!window.isDestroyed() && !window.webContents.isDestroyed())
				window.webContents.send(WEATHER_MEDIA_CHANGED, snapshot);
	};
	ipcMain.handle(
		WEATHER_MEDIA_REQUEST,
		async (event, input: unknown): Promise<WeatherMediaReply> => {
			if (
				disposed ||
				!BrowserWindow.fromWebContents(event.sender) ||
				event.senderFrame !== event.sender.mainFrame ||
				!canRequestWeatherMedia(
					event.sender.getURL(),
					renderer,
					input,
					event.sender === managementWindow()?.webContents,
				) ||
				!Schema.is(WeatherMediaCommand)(input)
			)
				return {
					_tag: "failure",
					code: "QUAKE.WEATHER.REQUEST_INVALID",
					message: "Weather/media request was rejected",
				};
			return track(
				(async () => {
					const reply = await runtime.runPromise(
						WeatherMediaController.request(input),
					);
					if (input._tag === "configure" || input._tag === "media")
						await broadcast();
					return reply;
				})(),
			);
		},
	);
	// One bounded poller shares the native service with card and key controls.
	let polling: Promise<void> | undefined;
	const timer = setInterval(() => {
		if (
			disposed ||
			polling ||
			!BrowserWindow.getAllWindows().some(
				(window) => !window.isDestroyed() && window.isVisible(),
			)
		)
			return;
		polling = track(broadcast());
		void polling.then(
			() => {
				polling = undefined;
			},
			() => {
				polling = undefined;
			},
		);
	}, 1500);
	return {
		dispose: () => {
			if (shutdown) return shutdown;
			disposed = true;
			clearInterval(timer);
			ipcMain.removeHandler(WEATHER_MEDIA_REQUEST);
			shutdown = (async () => {
				await Promise.allSettled([...pending]);
				await runtime.dispose();
			})();
			return shutdown;
		},
	};
}
