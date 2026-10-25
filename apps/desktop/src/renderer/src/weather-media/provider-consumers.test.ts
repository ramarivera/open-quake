import { Effect, Layer, ManagedRuntime } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { weatherSettings } from "../../../main/weather-media/test-fixtures";
import { WeatherNetwork } from "../../../main/weather-media/weather-network";
import { WeatherService } from "../../../main/weather-media/weather-service";
import { WeatherNetworkFailed } from "../../../shared/weather-media-errors";
import { ClockWeatherCard } from "./ClockCards";

// Provider semantics from the official WWO condition table, exercised through
// fallback decoding and the card. No assertion reads the conversion table.
const conditions = [
	[113, "Clear/Sunny", 0, "clear", "Clear", "Klar"],
	[116, "Partly Cloudy", 2, "partlyCloudy", "Cloudy", "Bewölkt"],
	[119, "Cloudy", 3, "cloudy", "Overcast", "Bedeckt"],
	[122, "Overcast", 3, "cloudy", "Overcast", "Bedeckt"],
	[143, "Mist", 45, "fog", "Fog", "Nebel"],
	[176, "Patchy rain nearby", 80, "rain", "Rain", "Regen"],
	[179, "Patchy snow nearby", 85, "snow", "Snow", "Schnee"],
	[182, "Patchy sleet nearby", 71, "snow", "Snow", "Schnee"],
	[
		185,
		"Patchy freezing drizzle nearby",
		56,
		"drizzle",
		"Drizzle",
		"Sprühregen",
	],
	[200, "Thundery outbreaks nearby", 95, "thunder", "Storm", "Gewitter"],
	[227, "Blowing snow", 71, "snow", "Snow", "Schnee"],
	[230, "Blizzard", 75, "snow", "Snow", "Schnee"],
	[248, "Fog", 45, "fog", "Fog", "Nebel"],
	[260, "Freezing fog", 48, "fog", "Fog", "Nebel"],
	[263, "Patchy light drizzle", 51, "drizzle", "Drizzle", "Sprühregen"],
	[281, "Freezing drizzle", 56, "drizzle", "Drizzle", "Sprühregen"],
	[284, "Heavy freezing drizzle", 57, "drizzle", "Drizzle", "Sprühregen"],
	[314, "Moderate or heavy freezing rain", 67, "rain", "Rain", "Regen"],
	[317, "Light sleet", 71, "snow", "Snow", "Schnee"],
	[320, "Moderate or heavy sleet", 75, "snow", "Snow", "Schnee"],
	[350, "Ice pellets", 77, "snow", "Snow", "Schnee"],
	[356, "Moderate or heavy rain shower", 81, "rain", "Rain", "Regen"],
	[359, "Torrential rain shower", 82, "rain", "Rain", "Regen"],
	[362, "Light sleet showers", 85, "snow", "Snow", "Schnee"],
	[365, "Moderate or heavy sleet showers", 86, "snow", "Snow", "Schnee"],
	[368, "Light snow showers", 85, "snow", "Snow", "Schnee"],
	[371, "Moderate or heavy snow showers", 86, "snow", "Snow", "Schnee"],
	[374, "Light showers of ice pellets", 77, "snow", "Snow", "Schnee"],
	[
		377,
		"Moderate or heavy showers of ice pellets",
		77,
		"snow",
		"Snow",
		"Schnee",
	],
	[
		395,
		"Moderate or heavy snow with thunder",
		95,
		"thunder",
		"Storm",
		"Gewitter",
	],
] as const;

for (const locale of ["en", "de"] as const) {
	it.each(conditions)(
		`fallback %i %s reaches the ${locale} card without localized provider text`,
		async (providerCode, _condition, wmo, icon, english, german) => {
			const calls: string[] = [];
			const runtime = ManagedRuntime.make(
				WeatherService.Default.pipe(
					Layer.provide(
						Layer.succeed(WeatherNetwork, {
							json: (url) =>
								Effect.suspend(() => {
									calls.push(url);
									return url.startsWith("https://wttr.in/")
										? Effect.succeed({
												current_condition: [
													{
														temp_C: "11.4",
														weatherCode: String(providerCode),
														// German must not inherit the provider's English.
														...(locale === "de"
															? {
																	weatherDesc: [
																		{ value: "English provider text" },
																	],
																}
															: {}),
													},
												],
												weather: [{ maxtempC: "14.8", mintempC: "6.5" }],
											})
										: Effect.fail(
												WeatherNetworkFailed.fromCause("primary offline"),
											);
								}),
						}),
					),
				),
			);
			try {
				const result = await runtime.runPromise(
					WeatherService.fetchWeather(weatherSettings, locale),
				);
				expect(result).toMatchObject({
					_tag: "ready",
					data: { provider: "wttr.in", weatherCode: wmo },
				});
				if (result._tag !== "ready")
					throw new Error("Missing fallback weather");
				const description = locale === "en" ? english : german;
				expect(result.data.description).toBe(description);
				const card = renderToStaticMarkup(
					createElement(ClockWeatherCard, {
						city: result.data.city,
						unit: "celsius",
						locale,
						state: { kind: "ready", ...result.data },
					}),
				);
				expect(card).toContain(`data-weather-icon="${icon}"`);
				expect(card).toContain(`title="${description}"`);
				expect(card).not.toContain("English provider text");
				expect(calls).toHaveLength(2);
				expect(new URL(calls[1] ?? "").searchParams.get("lang")).toBe(locale);
			} finally {
				await runtime.dispose();
			}
		},
	);
}

it.each([
	"",
	"https://forecast.example/api?temperature_unit=fahrenheit&model=best_match",
	"https://forecast.example/api?temperature_unit=fahrenheit&temperature_unit=celsius&model=best_match&model=icon",
	"https://forecast.example/api?temperature_unit=celsius&temperature_unit=fahrenheit&model=best_match",
])("canonical cache and card conversion for URL %s", async (forecastUrl) => {
	const calls: URL[] = [];
	const runtime = ManagedRuntime.make(
		WeatherService.Default.pipe(
			Layer.provide(
				Layer.succeed(WeatherNetwork, {
					json: (url) =>
						Effect.sync(() => {
							const parsed = new URL(url);
							calls.push(parsed);
							const fahrenheit = parsed.searchParams
								.getAll("temperature_unit")
								.includes("fahrenheit");
							return {
								current: {
									temperature_2m: fahrenheit ? 54.32 : 12.4,
									weather_code: 2,
								},
								daily: {
									temperature_2m_max: [fahrenheit ? 59.72 : 15.4],
									temperature_2m_min: [fahrenheit ? 44.78 : 7.1],
								},
							};
						}),
				}),
			),
		),
	);
	try {
		for (const unit of [
			"fahrenheit",
			"celsius",
			"fahrenheit",
			"celsius",
		] as const) {
			const result = await runtime.runPromise(
				WeatherService.fetchWeather(
					{ ...weatherSettings, forecastUrl, unit },
					"en",
				),
			);
			const [temperature, high, low] =
				unit === "celsius" ? [12, 15, 7] : [54, 60, 45];
			expect(result).toMatchObject({
				_tag: "ready",
				data: { temperature, high, low },
			});
			if (result._tag !== "ready") throw new Error("Missing forecast");
			const card = renderToStaticMarkup(
				createElement(ClockWeatherCard, {
					city: result.data.city,
					unit,
					state: { kind: "ready", ...result.data },
				}),
			);
			expect(card).toContain(`${temperature}<sup>°</sup>`);
			expect(card).toContain(`H</span> ${high}°`);
			expect(card).toContain(`L</span> ${low}°`);
		}
		expect(calls).toHaveLength(1);
		expect(calls[0]?.searchParams.getAll("temperature_unit")).toEqual([
			"celsius",
		]);
		if (forecastUrl)
			expect(calls[0]?.searchParams.getAll("model")).toEqual(
				new URL(forecastUrl).searchParams.getAll("model"),
			);
	} finally {
		await runtime.dispose();
	}
});
