import { Effect, Layer, ManagedRuntime } from "effect";
import { expect, it } from "vitest";
import {
	DEFAULT_WEATHER_SETTINGS,
	type WeatherMediaCommand,
} from "../../shared/weather-media-contracts";
import { WeatherMediaController } from "./controller";
import { WeatherSettingsRepository } from "./settings-repository";
import { systemMediaStub } from "./system-media";
import { forecastFixture, weatherSettings } from "./test-fixtures";
import { WeatherNetwork } from "./weather-network";

it("controller cache read/clear isolates instances and sides, refresh keeps key settings separate", async () => {
	const calls: string[] = [];
	let writes = 0;
	const runtime = ManagedRuntime.make(
		WeatherMediaController.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(WeatherSettingsRepository, {
						load: () => Effect.succeed(DEFAULT_WEATHER_SETTINGS),
						save: () =>
							Effect.sync(() => {
								writes++;
							}),
					}),
					systemMediaStub("darwin"),
					Layer.succeed(WeatherNetwork, {
						json: (url) =>
							Effect.sync(() => {
								calls.push(url);
								return forecastFixture;
							}),
					}),
				),
			),
		),
	);
	const request = (command: WeatherMediaCommand) =>
		runtime.runPromise(WeatherMediaController.request(command));
	const scope = {
		instanceId: "clock-a",
		side: "panel" as const,
		settings: weatherSettings,
	};
	const other = {
		...scope,
		instanceId: "clock-b",
		settings: {
			...weatherSettings,
			city: "Paris",
			location: {
				lat: 48.85,
				lon: 2.35,
				name: "Paris",
				country: "France",
				sourceCity: "Paris",
			},
		},
	};
	try {
		expect(await request({ _tag: "getCache", ...scope, locale: "en" })).toEqual(
			{ _tag: "cache", result: { _tag: "empty" } },
		);
		expect(calls).toHaveLength(0);
		await request({ _tag: "weather", ...scope, locale: "en" });
		await request({ _tag: "weather", ...other, locale: "en" });
		await request({ _tag: "weather", ...scope, side: "edit", locale: "en" });
		expect(calls).toHaveLength(3);
		expect(
			await request({
				_tag: "getCache",
				...scope,
				settings: { ...weatherSettings, unit: "fahrenheit" },
				locale: "en",
			}),
		).toMatchObject({
			_tag: "cache",
			result: { _tag: "ready", data: { temperature: 54 } },
		});
		expect(calls).toHaveLength(3);
		await request({ _tag: "clearCache", ...scope });
		expect(await request({ _tag: "getCache", ...scope, locale: "en" })).toEqual(
			{ _tag: "cache", result: { _tag: "empty" } },
		);
		expect(
			await request({ _tag: "getCache", ...other, locale: "en" }),
		).toMatchObject({
			_tag: "cache",
			result: { _tag: "ready", data: { city: "Paris" } },
		});
		await request({ _tag: "weather", ...scope, locale: "en" });
		expect(calls).toHaveLength(4);
		expect(await request({ _tag: "configChanged" })).toMatchObject({
			_tag: "snapshot",
			snapshot: { refreshRevision: 1, settings: DEFAULT_WEATHER_SETTINGS },
		});
		expect(writes).toBe(0);
	} finally {
		await runtime.dispose();
	}
});

it("MGMT-271 retains selected session and launcher through controller restart", async () => {
	let settings: import("../../shared/weather-media-contracts").WeatherSettings =
		{
			...DEFAULT_WEATHER_SETTINGS,
			mediaTarget: "player-b",
			mediaLauncher: "apple",
		};
	const targets: (string | null | undefined)[] = [];
	const { SystemMediaAdapter } = await import("./system-media");
	const make = () =>
		ManagedRuntime.make(
			WeatherMediaController.Default.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.succeed(WeatherSettingsRepository, {
							load: () => Effect.succeed(settings),
							save: (next) =>
								Effect.sync(() => {
									settings = next;
								}),
						}),
						Layer.succeed(SystemMediaAdapter, {
							read: (target) =>
								Effect.sync(() => {
									targets.push(target);
									return { session: null, error: null };
								}),
							control: () => Effect.succeed(false),
						}),
						Layer.succeed(WeatherNetwork, {
							json: () => Effect.die("media settings must not fetch weather"),
						}),
					),
				),
			),
		);
	const first = make();
	await first.runPromise(
		WeatherMediaController.request({
			_tag: "configure",
			settings: {
				...settings,
				mediaTarget: "saved-target",
				mediaLauncher: "qq",
			},
		}),
	);
	await first.dispose();
	const second = make();
	try {
		const snapshot = await second.runPromise(WeatherMediaController.read());
		expect(snapshot.settings).toMatchObject({
			mediaTarget: "saved-target",
			mediaLauncher: "qq",
		});
		expect(targets.at(-1)).toBe("saved-target");
		expect(snapshot.media.error).toBe("SESSION_LOST");
	} finally {
		await second.dispose();
	}
});
