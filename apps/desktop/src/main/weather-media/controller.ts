import { Effect } from "effect";
import { matchingLocation } from "../../shared/weather-invariants";
import {
	DEFAULT_WEATHER_SETTINGS,
	type WeatherLocale,
	type WeatherMediaCommand,
	type WeatherMediaReply,
	type WeatherMediaSnapshot,
	type WeatherResult,
	type WeatherSettings,
} from "../../shared/weather-media-contracts";
import { WeatherSettingsRepository } from "./settings-repository";
import { SystemMediaService } from "./system-media";
import { WeatherService } from "./weather-service";

export class WeatherMediaController extends Effect.Service<WeatherMediaController>()(
	"WeatherMediaController",
	{
		accessors: true,
		dependencies: [WeatherService.Default, SystemMediaService.Default],
		effect: Effect.gen(function* () {
			const repository = yield* WeatherSettingsRepository;
			const weather = yield* WeatherService;
			const media = yield* SystemMediaService;
			const lock = yield* Effect.makeSemaphore(1);
			let settings = yield* repository
				.load()
				.pipe(
					Effect.catchTag("WeatherPersistenceFailed", () =>
						Effect.succeed(DEFAULT_WEATHER_SETTINGS),
					),
				);
			let revision = 0;
			const read: () => Effect.Effect<WeatherMediaSnapshot> = Effect.fn(
				"WeatherMediaController.read",
			)(function* () {
				return { revision, settings, media: yield* media.read() };
			});
			const configure = Effect.fn("WeatherMediaController.configure")(
				(next: WeatherSettings): Effect.Effect<WeatherMediaReply> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							const valid = {
								...next,
								city: next.city.trim(),
								location: matchingLocation(next) ? next.location : null,
							};
							return yield* repository.save(valid).pipe(
								Effect.flatMap(() => {
									settings = valid;
									revision++;
									return read().pipe(
										Effect.map(
											(snapshot): WeatherMediaReply => ({
												_tag: "snapshot",
												snapshot,
											}),
										),
									);
								}),
								Effect.catchTag("WeatherPersistenceFailed", (error) =>
									Effect.succeed<WeatherMediaReply>({
										_tag: "failure",
										code: error.code,
										message: error.message,
									}),
								),
							);
						}),
					),
			);
			const fetchWeather = Effect.fn("WeatherMediaController.weather")(
				(locale: WeatherLocale): Effect.Effect<WeatherResult> =>
					weather.fetchWeather(settings, locale),
			);
			const request = Effect.fn("WeatherMediaController.request")(
				(command: WeatherMediaCommand): Effect.Effect<WeatherMediaReply> => {
					switch (command._tag) {
						case "read":
							return read().pipe(
								Effect.map((snapshot) => ({ _tag: "snapshot", snapshot })),
							);
						case "configure":
							return configure(command.settings);
						case "verifyCity":
							return weather
								.verifyCity(command.query, command.locale)
								.pipe(Effect.map((result) => ({ _tag: "city", result })));
						case "weather":
							return fetchWeather(command.locale).pipe(
								Effect.map((result) => ({ _tag: "weather", result })),
							);
						case "media":
							return media
								.control(command.intent)
								.pipe(Effect.map((result) => ({ _tag: "control", ...result })));
					}
				},
			);
			return { request, read };
		}),
	},
) {}
