import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Layer, type ManagedRuntime, Schema } from "effect";
import { BrowserWindow, ipcMain } from "electron";
import {
	WEATHER_MEDIA_CHANGED,
	WEATHER_MEDIA_REQUEST,
	WeatherMediaCommand,
	type WeatherMediaReply,
} from "../../shared/weather-media-contracts";
import { canRequestClock } from "../clock/clock-ipc";
import { WeatherMediaController } from "./controller";
import { weatherSettingsLive } from "./settings-repository";
import { systemMediaStub } from "./system-media";
import { weatherNetworkLive } from "./weather-network";

export const weatherMediaLive = (root: string, platform: string) =>
	WeatherMediaController.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				weatherSettingsLive(root),
				weatherNetworkLive,
				systemMediaStub(platform),
			),
		),
	);

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
	runtime: ManagedRuntime.ManagedRuntime<WeatherMediaController, never>,
	managementWindow: () => BrowserWindow | undefined,
	renderer = process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href,
): { dispose: () => Promise<void> } {
	const broadcast = async (): Promise<void> => {
		const snapshot = await runtime.runPromise(WeatherMediaController.read());
		for (const window of BrowserWindow.getAllWindows())
			if (!window.isDestroyed() && !window.webContents.isDestroyed())
				window.webContents.send(WEATHER_MEDIA_CHANGED, snapshot);
	};
	ipcMain.handle(
		WEATHER_MEDIA_REQUEST,
		async (event, input: unknown): Promise<WeatherMediaReply> => {
			if (
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
			const reply = await runtime.runPromise(
				WeatherMediaController.request(input),
			);
			if (input._tag === "configure" || input._tag === "media")
				await broadcast();
			return reply;
		},
	);
	// The stub is side-effect-free. A future approved adapter shares this poller.
	let polling: Promise<void> | undefined;
	const timer = setInterval(() => {
		if (
			polling ||
			!BrowserWindow.getAllWindows().some(
				(window) => !window.isDestroyed() && window.isVisible(),
			)
		)
			return;
		polling = broadcast();
		void polling.finally(() => {
			polling = undefined;
		});
	}, 1500);
	return {
		dispose: async () => {
			clearInterval(timer);
			ipcMain.removeHandler(WEATHER_MEDIA_REQUEST);
			await polling;
			await runtime.dispose();
		},
	};
}
