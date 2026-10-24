import { Deferred, Effect, Layer, ManagedRuntime } from "effect";
import { BrowserWindow, ipcMain } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_WEATHER_SETTINGS,
	WEATHER_MEDIA_REQUEST,
} from "../../shared/weather-media-contracts";
import { WeatherMediaController } from "./controller";
import { registerWeatherMedia } from "./index";
import { WeatherSettingsRepository } from "./settings-repository";
import { SystemMediaAdapter } from "./system-media";
import { mediaSession } from "./test-fixtures";
import { WeatherNetwork } from "./weather-network";

vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows: vi.fn(() => []), fromWebContents: vi.fn() },
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

class TestWindow {
	readonly webContents = {
		mainFrame: {},
		getURL: () => this.url,
		isDestroyed: () => false,
		send: vi.fn(),
	};
	url = "file:///app/index.html?surface=management";
	isDestroyed = () => false;
	isVisible = () => true;
}

describe("weather/media registration ownership", () => {
	afterEach(() => vi.useRealTimers());

	it.each(["configure", "media"] as const)(
		"drains admitted %s requests, rejects queued calls and suppresses broadcasts during shutdown",
		async (command) => {
			const started = await Effect.runPromise(Deferred.make<void>());
			const release = await Effect.runPromise(Deferred.make<void>());
			let saved = DEFAULT_WEATHER_SETTINGS;
			let finalized = false;
			const runtime = ManagedRuntime.make(
				Layer.merge(
					WeatherMediaController.Default.pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(WeatherSettingsRepository, {
									load: () => Effect.succeed(DEFAULT_WEATHER_SETTINGS),
									save: (settings) =>
										Effect.gen(function* () {
											yield* Deferred.succeed(started, undefined);
											yield* Deferred.await(release);
											saved = settings;
										}),
								}),
								Layer.succeed(SystemMediaAdapter, {
									read: () =>
										Effect.succeed({ session: mediaSession, error: null }),
									control: () =>
										Deferred.succeed(started, undefined).pipe(
											Effect.zipRight(Deferred.await(release)),
											Effect.as(true),
										),
								}),
								Layer.succeed(WeatherNetwork, {
									json: () =>
										Effect.die("Disabled weather must not request IO"),
								}),
							),
						),
					),
					Layer.scopedDiscard(
						Effect.addFinalizer(() =>
							Effect.sync(() => {
								finalized = true;
							}),
						),
					),
				),
			);
			const window = new TestWindow();
			vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
				window as unknown as BrowserWindow,
			]);
			vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(
				window as unknown as BrowserWindow,
			);
			const registration = registerWeatherMedia(
				runtime,
				() => window as unknown as BrowserWindow,
				"file:///app/index.html",
			);
			const handler = vi.mocked(ipcMain.handle).mock.calls.at(-1)?.[1];
			if (!handler) throw new Error("Weather/media IPC handler missing");
			const event = {
				sender: window.webContents,
				senderFrame: window.webContents.mainFrame,
			} as unknown as Electron.IpcMainInvokeEvent;
			const pending = Promise.resolve(
				handler(
					event,
					command === "configure"
						? {
								_tag: "configure",
								settings: { ...DEFAULT_WEATHER_SETTINGS, city: "Berlin" },
							}
						: { _tag: "media", intent: "toggle" },
				),
			).then(
				(reply: unknown) => reply,
				() => "request was interrupted",
			);
			try {
				await Effect.runPromise(Deferred.await(started));
				let disposed = false;
				const shutdown = registration.dispose().then(() => {
					disposed = true;
				});
				await Promise.resolve();
				expect(ipcMain.removeHandler).toHaveBeenCalledWith(
					WEATHER_MEDIA_REQUEST,
				);
				expect(disposed).toBe(false);
				expect(finalized).toBe(false);
				expect(await handler(event, { _tag: "read" })).toMatchObject({
					_tag: "failure",
					code: "QUAKE.WEATHER.REQUEST_INVALID",
				});
				await Effect.runPromise(Deferred.succeed(release, undefined));
				expect(await pending).toMatchObject(
					command === "configure"
						? {
								_tag: "snapshot",
								snapshot: { settings: { city: "Berlin" } },
							}
						: { _tag: "control", accepted: true },
				);
				await shutdown;
				expect(saved.city).toBe(command === "configure" ? "Berlin" : "");
				expect(finalized).toBe(true);
				expect(window.webContents.send).not.toHaveBeenCalled();
				await registration.dispose();
				expect(ipcMain.removeHandler).toHaveBeenCalledTimes(1);
			} finally {
				await Effect.runPromise(Deferred.succeed(release, undefined));
				await pending;
				await registration.dispose();
			}
		},
	);
});
