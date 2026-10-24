import { Clock, Effect, Option, Schema } from "effect";
import {
	matchingLocation,
	validCityQuery,
	WTTR_CODES,
	weatherIn,
} from "../../shared/weather-invariants";
import {
	type CityResult,
	WEATHER_REFRESH_MS,
	type WeatherData,
	type WeatherLocale,
	type WeatherLocation,
	type WeatherResult,
	type WeatherSettings,
} from "../../shared/weather-media-contracts";
import {
	type WeatherFetchError,
	WeatherResponseInvalid,
} from "../../shared/weather-media-errors";
import { weatherDescription } from "../../shared/weather-media-strings";
import { WeatherNetwork } from "./weather-network";

const GeoResponse = Schema.Struct({
	results: Schema.optional(
		Schema.Array(
			Schema.Struct({
				latitude: Schema.Finite.pipe(Schema.between(-90, 90)),
				longitude: Schema.Finite.pipe(Schema.between(-180, 180)),
				name: Schema.String,
				country: Schema.optional(Schema.String),
				country_code: Schema.optional(Schema.String),
				feature_code: Schema.optional(Schema.String),
			}),
		),
	),
});
const ForecastResponse = Schema.Struct({
	current: Schema.Struct({
		temperature_2m: Schema.Finite,
		weather_code: Schema.Finite,
	}),
	daily: Schema.Struct({
		temperature_2m_max: Schema.NonEmptyArray(Schema.Finite),
		temperature_2m_min: Schema.NonEmptyArray(Schema.Finite),
	}),
});
const Numeric = Schema.Union(
	Schema.Finite,
	Schema.NumberFromString.pipe(Schema.finite()),
);
const WttrText = Schema.optional(
	Schema.Array(Schema.Struct({ value: Schema.String })),
);
const WttrResponse = Schema.Struct({
	current_condition: Schema.NonEmptyArray(
		Schema.Struct({
			temp_C: Numeric,
			weatherCode: Numeric,
			weatherDesc: WttrText,
			lang_zh: WttrText,
			lang_fr: WttrText,
			lang_de: WttrText,
			lang_ja: WttrText,
			lang_es: WttrText,
			lang_it: WttrText,
			lang_ko: WttrText,
		}),
	),
	weather: Schema.NonEmptyArray(
		Schema.Struct({ maxtempC: Numeric, mintempC: Numeric }),
	),
});
const IpResponse = Schema.Struct({
	city: Schema.NonEmptyString.pipe(Schema.maxLength(200)),
	country: Schema.String.pipe(Schema.maxLength(200)),
	latitude: Schema.Finite.pipe(Schema.between(-90, 90)),
	longitude: Schema.Finite.pipe(Schema.between(-180, 180)),
	success: Schema.optional(Schema.Boolean),
});
const decode = <A, I>(
	schema: Schema.Schema<A, I>,
	value: unknown,
): Effect.Effect<A, WeatherResponseInvalid> =>
	Schema.decodeUnknown(schema)(value).pipe(
		Effect.catchTag("ParseError", (cause) =>
			Effect.fail(WeatherResponseInvalid.fromCause(cause)),
		),
	);

export const forecastUrl = (
	base: string,
	location: WeatherLocation,
): string => {
	const url = new URL(base || "https://api.open-meteo.com/v1/forecast");
	for (const [name, value] of Object.entries({
		latitude: String(location.lat),
		longitude: String(location.lon),
		current: "temperature_2m,weather_code",
		daily: "temperature_2m_max,temperature_2m_min,weather_code",
		timezone: "auto",
		forecast_days: "3",
	}))
		url.searchParams.set(name, value);
	return url.href;
};

export class WeatherService extends Effect.Service<WeatherService>()(
	"WeatherService",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const network = yield* WeatherNetwork;
			const lock = yield* Effect.makeSemaphore(1);
			let cached: { key: string; at: number; data: WeatherData } | undefined;
			const search: (
				query: string,
				locale: WeatherLocale,
			) => Effect.Effect<CityResult, WeatherFetchError> = Effect.fn(
				"WeatherService.search",
			)(function* (query: string, locale: WeatherLocale) {
				if (!validCityQuery(query))
					return { _tag: "not-found" } satisfies CityResult;
				const [name = "", country = ""] = query
					.trim()
					.split(",")
					.map((part) => part.trim());
				const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
				const chineseQuery = locale === "zh" && /\p{Script=Han}/u.test(name);
				url.search = new URLSearchParams({
					name,
					count: "50",
					language: locale,
					format: "json",
				}).toString();
				if (chineseQuery && !country)
					url.searchParams.set("country_code", "CN");
				const response = yield* network
					.json(url.href)
					.pipe(Effect.flatMap((value) => decode(GeoResponse, value)));
				const normalized = name.toLocaleLowerCase();
				const wanted = country.toLocaleLowerCase();
				const countryCode = wanted === "uk" ? "gb" : wanted;
				const candidates = (response.results ?? []).filter(
					(item) =>
						!country ||
						item.country?.toLocaleLowerCase() === wanted ||
						item.country_code?.toLocaleLowerCase() === countryCode,
				);
				const score = (item: (typeof candidates)[number]): number =>
					(item.name.toLocaleLowerCase() === normalized
						? 100
						: item.name.toLocaleLowerCase().startsWith(normalized)
							? 30
							: 0) +
					(item.feature_code === "PPLC"
						? 10
						: item.feature_code === "PPLA"
							? 8
							: 3);
				const match = [...candidates].sort((a, b) => score(b) - score(a))[0];
				return match
					? {
							_tag: "matched",
							location: {
								lat: match.latitude,
								lon: match.longitude,
								name: match.name,
								country: match.country ?? "",
								sourceCity: query.trim(),
							},
						}
					: ({ _tag: "not-found" } satisfies CityResult);
			});
			const verifyCity = Effect.fn("WeatherService.verifyCity")(
				(query: string, locale: WeatherLocale): Effect.Effect<CityResult> =>
					search(query, locale).pipe(
						Effect.catchTags({
							WeatherRequestTimedOut: () =>
								Effect.succeed<CityResult>({ _tag: "timeout" }),
							WeatherNetworkFailed: () =>
								Effect.succeed<CityResult>({ _tag: "network" }),
							WeatherResponseInvalid: () =>
								Effect.succeed<CityResult>({ _tag: "network" }),
						}),
						Effect.timeoutOption("12 seconds"),
						Effect.map(
							Option.getOrElse((): CityResult => ({ _tag: "timeout" })),
						),
					),
			);
			const autoCity = Effect.fn("WeatherService.autoCity")(function* () {
				const lookup = (url: string, timeout: number) =>
					network.json(url).pipe(
						Effect.timeoutOption(timeout),
						Effect.flatMap(
							Option.match({
								onNone: () =>
									Effect.fail(
										WeatherResponseInvalid.fromCause("IP lookup timeout"),
									),
								onSome: (value) => decode(IpResponse, value),
							}),
						),
						Effect.flatMap((data) =>
							data.success === false || !data.city.trim()
								? Effect.fail(
										WeatherResponseInvalid.fromCause("IP city missing"),
									)
								: Effect.succeed<WeatherLocation>({
										lat: data.latitude,
										lon: data.longitude,
										name: data.city.trim(),
										country: data.country,
										sourceCity: data.city.trim(),
									}),
						),
					);
				return yield* lookup("https://ipapi.co/json/", 8000).pipe(
					Effect.catchTags({
						WeatherRequestTimedOut: () => lookup("https://ipwho.is/", 4000),
						WeatherNetworkFailed: () => lookup("https://ipwho.is/", 4000),
						WeatherResponseInvalid: () => lookup("https://ipwho.is/", 4000),
					}),
				);
			});
			const forecast = Effect.fn("WeatherService.forecast")(function* (
				settings: WeatherSettings,
				location: WeatherLocation,
				locale: WeatherLocale,
			) {
				const city =
					locale === "zh" && /\p{Script=Han}/u.test(location.sourceCity)
						? location.sourceCity
						: location.name;
				const primary = network
					.json(forecastUrl(settings.forecastUrl, location))
					.pipe(
						Effect.flatMap((value) => decode(ForecastResponse, value)),
						Effect.map(
							(response): WeatherData => ({
								city,
								temperature: response.current.temperature_2m,
								high: response.daily.temperature_2m_max[0],
								low: response.daily.temperature_2m_min[0],
								weatherCode: response.current.weather_code,
								description: weatherDescription(
									response.current.weather_code,
									locale,
								),
								stale: false,
								provider: "open-meteo",
							}),
						),
					);
				const fallback = network
					.json(
						`https://wttr.in/${location.lat},${location.lon}?format=j1&lang=${locale}`,
					)
					.pipe(
						Effect.flatMap((value) => decode(WttrResponse, value)),
						Effect.map((response): WeatherData => {
							const current = response.current_condition[0];
							const code = WTTR_CODES[String(current.weatherCode)] ?? 3;
							const texts = {
								en: current.weatherDesc,
								zh: current.lang_zh,
								fr: current.lang_fr,
								de: current.lang_de,
								ja: current.lang_ja,
								es: current.lang_es,
								it: current.lang_it,
								ko: current.lang_ko,
							};
							return {
								city,
								temperature: current.temp_C,
								high: response.weather[0].maxtempC,
								low: response.weather[0].mintempC,
								weatherCode: code,
								description:
									texts[locale]?.[0]?.value || weatherDescription(code, locale),
								stale: false,
								provider: "wttr.in",
							};
						}),
					);
				return yield* primary.pipe(
					Effect.catchTags({
						WeatherRequestTimedOut: () => fallback,
						WeatherNetworkFailed: () => fallback,
						WeatherResponseInvalid: () => fallback,
					}),
				);
			});
			const fetchWeather = Effect.fn("WeatherService.fetch")(
				(
					settings: WeatherSettings,
					locale: WeatherLocale,
				): Effect.Effect<WeatherResult> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							if (
								!settings.enabled ||
								(!settings.city.trim() && !settings.ipLookup)
							)
								return { _tag: "empty" } satisfies WeatherResult;
							if (settings.city.trim() && !validCityQuery(settings.city)) {
								cached = undefined;
								return {
									_tag: "error",
									reason: "city-not-found",
								} satisfies WeatherResult;
							}
							const key = JSON.stringify([
								settings.city.trim(),
								settings.ipLookup,
								settings.location,
								settings.forecastUrl,
								locale,
							]);
							const now = yield* Clock.currentTimeMillis;
							if (cached?.key === key && now - cached.at < WEATHER_REFRESH_MS)
								return {
									_tag: "ready",
									data: weatherIn(cached.data, settings.unit),
									refreshAfterMs: WEATHER_REFRESH_MS - (now - cached.at),
								} satisfies WeatherResult;
							const load: Effect.Effect<WeatherResult, WeatherFetchError> =
								Effect.gen(function* () {
									const result: CityResult = !settings.city.trim()
										? { _tag: "matched", location: yield* autoCity() }
										: matchingLocation(settings) && settings.location
											? { _tag: "matched", location: settings.location }
											: yield* search(settings.city.trim(), locale);
									if (result._tag !== "matched") {
										cached = undefined;
										return {
											_tag: "error",
											reason: "city-not-found",
										} satisfies WeatherResult;
									}
									const data = yield* forecast(
										settings,
										result.location,
										locale,
									);
									cached = { key, at: yield* Clock.currentTimeMillis, data };
									return {
										_tag: "ready",
										data: weatherIn(data, settings.unit),
										refreshAfterMs: WEATHER_REFRESH_MS,
									} satisfies WeatherResult;
								});
							const unavailable = (): WeatherResult =>
								cached?.key === key
									? {
											_tag: "ready",
											refreshAfterMs: WEATHER_REFRESH_MS,
											data: weatherIn(
												{ ...cached.data, stale: true },
												settings.unit,
											),
										}
									: { _tag: "error", reason: "unavailable" };
							return yield* load.pipe(
								Effect.catchTags({
									WeatherRequestTimedOut: () => Effect.succeed(unavailable()),
									WeatherNetworkFailed: () => Effect.succeed(unavailable()),
									WeatherResponseInvalid: () => Effect.succeed(unavailable()),
								}),
							);
						}),
					),
			);
			return { verifyCity, fetchWeather };
		}),
	},
) {}
