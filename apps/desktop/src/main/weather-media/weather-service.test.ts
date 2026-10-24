import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, TestClock } from "effect";
import {
	DEFAULT_WEATHER_SETTINGS,
	WEATHER_REFRESH_MS,
} from "../../shared/weather-media-contracts";
import { WeatherNetworkFailed } from "../../shared/weather-media-errors";
import { cityFixture, forecastFixture, weatherSettings } from "./test-fixtures";
import { WeatherNetwork } from "./weather-network";
import { WeatherService } from "./weather-service";

function fixture() {
	const calls: string[] = [];
	const state = {
		primaryFails: false,
		fallbackFails: false,
		geocodeEmpty: false,
		ipFails: false,
		fallbackEnglish: "",
		fallbackGerman: "",
	};
	const network = Layer.succeed(WeatherNetwork, {
		json: (url: string) =>
			Effect.suspend(() => {
				calls.push(url);
				if (url.includes("ipapi.co") || url.includes("ipwho.is"))
					return state.ipFails
						? Effect.fail(WeatherNetworkFailed.fromCause("offline"))
						: Effect.succeed<unknown>({ city: "Berlin" });
				if (url.includes("geocoding"))
					return Effect.succeed<unknown>(
						state.geocodeEmpty ? { results: [] } : cityFixture,
					);
				if (url.includes("wttr.in"))
					return state.fallbackFails
						? Effect.fail(WeatherNetworkFailed.fromCause("offline"))
						: Effect.succeed<unknown>({
								current_condition: [
									{
										temp_C: "11.4",
										weatherCode: "353",
										weatherDesc: [{ value: state.fallbackEnglish }],
										lang_de: [{ value: state.fallbackGerman }],
									},
								],
								weather: [{ maxtempC: "14.8", mintempC: "6.5" }],
							});
				return state.primaryFails
					? Effect.fail(WeatherNetworkFailed.fromCause("offline"))
					: Effect.succeed<unknown>(forecastFixture);
			}),
	});
	return {
		calls,
		state,
		layer: WeatherService.Default.pipe(Layer.provide(network)),
	};
}

it.effect(
	"consent: defaults, disabled weather and empty manual city make no requests",
	() => {
		const f = fixture();
		return Effect.gen(function* () {
			const service = yield* WeatherService;
			expect(
				yield* service.fetchWeather(DEFAULT_WEATHER_SETTINGS, "en"),
			).toEqual({ _tag: "empty" });
			expect(
				yield* service.fetchWeather(
					{ ...weatherSettings, city: "", location: null },
					"en",
				),
			).toEqual({ _tag: "empty" });
			expect(f.calls).toEqual([]);
		}).pipe(Effect.provide(f.layer));
	},
);
it.effect(
	"uses verified coordinates, converts before rounding and caches for 30 min",
	() => {
		const f = fixture();
		return Effect.gen(function* () {
			const service = yield* WeatherService;
			expect(
				yield* service.fetchWeather(
					{ ...weatherSettings, unit: "fahrenheit" },
					"en",
				),
			).toMatchObject({
				_tag: "ready",
				data: { temperature: 54, high: 60, low: 45, provider: "open-meteo" },
			});
			expect(f.calls).toHaveLength(1);
			expect(new URL(f.calls[0] ?? "").searchParams.get("latitude")).toBe(
				"52.52",
			);
			yield* service.fetchWeather(weatherSettings, "en");
			expect(f.calls).toHaveLength(1);
			yield* TestClock.adjust(WEATHER_REFRESH_MS);
			yield* service.fetchWeather(weatherSettings, "en");
			expect(f.calls).toHaveLength(2);
		}).pipe(Effect.provide(f.layer));
	},
);
it.effect("fallback maps wttr codes and supplies today's high/low", () => {
	const f = fixture();
	f.state.primaryFails = true;
	return Effect.gen(function* () {
		const result = yield* WeatherService.fetchWeather(weatherSettings, "de");
		expect(result).toMatchObject({
			_tag: "ready",
			data: {
				temperature: 11,
				high: 15,
				low: 7,
				weatherCode: 80,
				description: "Regen",
				provider: "wttr.in",
			},
		});
		expect(f.calls).toHaveLength(2);
	}).pipe(Effect.provide(f.layer));
});
it.effect(
	"fallback selects the requested locale and never leaks English into another locale",
	() => {
		const f = fixture();
		f.state.primaryFails = true;
		f.state.fallbackEnglish = "Light rain shower";
		f.state.fallbackGerman = "Leichter Regenschauer";
		return Effect.gen(function* () {
			expect(
				yield* WeatherService.fetchWeather(weatherSettings, "de"),
			).toMatchObject({
				_tag: "ready",
				data: { description: "Leichter Regenschauer" },
			});
			expect(
				yield* WeatherService.fetchWeather(weatherSettings, "fr"),
			).toMatchObject({ _tag: "ready", data: { description: "Pluie" } });
		}).pipe(Effect.provide(f.layer));
	},
);
it.effect(
	"failed refresh retains only matching stale cache and changed cities invalidate coordinates",
	() => {
		const f = fixture();
		return Effect.gen(function* () {
			const service = yield* WeatherService;
			yield* service.fetchWeather(weatherSettings, "en");
			yield* TestClock.adjust(WEATHER_REFRESH_MS);
			f.state.primaryFails = true;
			f.state.fallbackFails = true;
			expect(yield* service.fetchWeather(weatherSettings, "en")).toMatchObject({
				_tag: "ready",
				data: { stale: true },
			});
			f.state.geocodeEmpty = true;
			expect(
				yield* service.fetchWeather(
					{ ...weatherSettings, city: "Paris" },
					"en",
				),
			).toEqual({ _tag: "error", reason: "city-not-found" });
			expect(
				f.calls.some(
					(url) => url.includes("geocoding") && url.includes("Paris"),
				),
			).toBe(true);
		}).pipe(Effect.provide(f.layer));
	},
);
it.effect("opt-in alone enables IP lookup and fallback IP service", () => {
	const f = fixture();
	return Effect.gen(function* () {
		expect(
			yield* WeatherService.fetchWeather(
				{ ...weatherSettings, city: "", location: null, ipLookup: true },
				"en",
			),
		).toMatchObject({ _tag: "ready" });
		expect(f.calls[0]).toBe("https://ipapi.co/json/");
	}).pipe(Effect.provide(f.layer));
});
it.effect(
	"invalid queries never reach the network, verification returns matched country",
	() => {
		const f = fixture();
		return Effect.gen(function* () {
			const service = yield* WeatherService;
			expect(yield* service.verifyCity("1!!", "en")).toEqual({
				_tag: "not-found",
			});
			expect(f.calls).toHaveLength(0);
			expect(yield* service.verifyCity("Berlin, DE", "en")).toMatchObject({
				_tag: "matched",
				location: { sourceCity: "Berlin, DE", country: "Germany" },
			});
		}).pipe(Effect.provide(f.layer));
	},
);
it.effect(
	"verification deadline interrupts the injected network after 12 s",
	() =>
		Effect.gen(function* () {
			const service = yield* WeatherService;
			const fiber = yield* Effect.fork(service.verifyCity("Berlin", "en"));
			yield* TestClock.adjust("12 seconds");
			expect(yield* Fiber.join(fiber)).toEqual({ _tag: "timeout" });
		}).pipe(
			Effect.provide(
				WeatherService.Default.pipe(
					Layer.provide(
						Layer.succeed(WeatherNetwork, { json: () => Effect.never }),
					),
				),
			),
		),
);
it.effect(
	"custom forecast URL reaches adapter with replaced coordinates and forecast parameters",
	() => {
		const f = fixture();
		return Effect.gen(function* () {
			yield* WeatherService.fetchWeather(
				{
					...weatherSettings,
					forecastUrl: "https://forecast.example/api?latitude=0&daily=bad",
				},
				"en",
			);
			const url = new URL(f.calls[0] ?? "");
			expect(url.hostname).toBe("forecast.example");
			expect(url.searchParams.getAll("latitude")).toEqual(["52.52"]);
			expect(url.searchParams.get("forecast_days")).toBe("3");
		}).pipe(Effect.provide(f.layer));
	},
);
