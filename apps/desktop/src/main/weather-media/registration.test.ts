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

	it("recovers polling after a rejected read and stops notifications after disposal", async () => {
		vi.useFakeTimers();
		const started = await Effect.runPromise(Deferred.make<void>());
		const release = await Effect.runPromise(Deferred.make<void>());
		let reads = 0;
		const runtime = ManagedRuntime.make(
			WeatherMediaController.Default.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.succeed(WeatherSettingsRepository, {
							load: () => Effect.succeed(DEFAULT_WEATHER_SETTINGS),
							save: () => Effect.void,
						}),
						Layer.succeed(WeatherNetwork, {
							json: () => Effect.die("Disabled weather must not request IO"),
						}),
						Layer.succeed(SystemMediaAdapter, {
							read: () =>
								Effect.suspend(() => {
									reads++;
									if (reads === 3)
										return Deferred.succeed(started, undefined).pipe(
											Effect.zipRight(Deferred.await(release)),
											Effect.as({ session: mediaSession, error: null }),
										);
									return reads === 1
										? Effect.die("Synthetic polling defect")
										: Effect.succeed({ session: mediaSession, error: null });
								}),
							control: () => Effect.succeed(false),
						}),
					),
				),
			),
		);
		const window = new TestWindow();
		vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
			window as unknown as BrowserWindow,
		]);
		const registration = registerWeatherMedia(
			runtime,
			() => window as unknown as BrowserWindow,
			"file:///app/index.html",
		);
		try {
			await vi.advanceTimersByTimeAsync(1500);
			expect(reads).toBe(1);
			expect(window.webContents.send).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1500);
			expect(reads).toBe(2);
			expect(window.webContents.send).toHaveBeenCalledOnce();
			await vi.advanceTimersByTimeAsync(1500);
			await Effect.runPromise(Deferred.await(started));
			let disposed = false;
			const shutdown = registration.dispose().then(() => {
				disposed = true;
			});
			await Promise.resolve();
			expect(disposed).toBe(false);
			await Effect.runPromise(Deferred.succeed(release, undefined));
			await shutdown;
			await vi.advanceTimersByTimeAsync(3000);
			expect(reads).toBe(3);
			expect(window.webContents.send).toHaveBeenCalledOnce();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			await Effect.runPromise(Deferred.succeed(release, undefined));
			await registration.dispose();
		}
	});

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

it("configuration refresh broadcasts to every window without replacing per-key settings", async () => {
	const first = new TestWindow();
	const second = new TestWindow();
	vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
		first as unknown as BrowserWindow,
		second as unknown as BrowserWindow,
	]);
	vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(
		first as unknown as BrowserWindow,
	);
	const runtime = ManagedRuntime.make(
		WeatherMediaController.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(WeatherSettingsRepository, {
						load: () => Effect.succeed(DEFAULT_WEATHER_SETTINGS),
						save: () => Effect.die("no global write"),
					}),
					Layer.succeed(WeatherNetwork, {
						json: () => Effect.die("no weather IO"),
					}),
					Layer.succeed(SystemMediaAdapter, {
						read: () => Effect.succeed({ session: null, error: null }),
						control: () => Effect.succeed(false),
					}),
				),
			),
		),
	);
	const registration = registerWeatherMedia(
		runtime,
		() => first as unknown as BrowserWindow,
		"file:///app/index.html",
	);
	try {
		const handler = vi
			.mocked(ipcMain.handle)
			.mock.calls.slice()
			.reverse()
			.find((call) => call[0] === WEATHER_MEDIA_REQUEST)?.[1];
		if (!handler) throw new Error("handler missing");
		const event = {
			sender: first.webContents,
			senderFrame: first.webContents.mainFrame,
		} as unknown as Electron.IpcMainInvokeEvent;
		expect(await handler(event, { _tag: "configChanged" })).toMatchObject({
			_tag: "snapshot",
			snapshot: { refreshRevision: 1, settings: DEFAULT_WEATHER_SETTINGS },
		});
		expect(first.webContents.send).toHaveBeenCalledOnce();
		expect(second.webContents.send).toHaveBeenCalledOnce();
		expect(second.webContents.send.mock.calls[0]?.[1]).toMatchObject({
			refreshRevision: 1,
		});
	} finally {
		await registration.dispose();
	}
});
