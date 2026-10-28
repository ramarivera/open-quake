// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	DEFAULT_WEATHER_SETTINGS,
	type WeatherMediaBridge,
	type WeatherSettings,
} from "../../../shared/weather-media-contracts";
import { WEATHER_MEDIA_STRINGS } from "../../../shared/weather-media-strings";
import { AppLocaleProvider } from "../i18n";
import { mount } from "../test/mount";
import { ClockWeatherSlot } from "./ClockCards";

const weather = vi.hoisted(() => {
	const request = vi.fn<WeatherMediaBridge["request"]>();
	vi.stubGlobal("quakeWeatherMedia", {
		request,
		onSnapshot: () => () => {},
	} satisfies WeatherMediaBridge);
	return { request };
});
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it.each(["en", "de"] as const)(
	"open-quake-ugb: %s weather shows setup, fetch failure and configuration recovery",
	async (locale) => {
		const empty: WeatherSettings = {
			...DEFAULT_WEATHER_SETTINGS,
			enabled: true,
		};
		const configured = { ...empty, city: "Berlin" };
		weather.request.mockImplementation(async (command) =>
			command._tag === "read"
				? {
						_tag: "snapshot",
						snapshot: {
							revision: 1,
							settings: empty,
							media: { revision: 0, session: null, error: null },
						},
					}
				: command._tag === "weather"
					? { _tag: "weather", result: { _tag: "empty" } }
					: { _tag: "rejected", reason: "unavailable" },
		);
		const content = (settings: WeatherSettings) => (
			<AppLocaleProvider bridge={null} initialLocale={locale}>
				<ClockWeatherSlot settings={settings} />
			</AppLocaleProvider>
		);
		const view = await mount(content(empty));
		const advance = async (ms: number) => {
			await act(async () => vi.advanceTimersByTimeAsync(ms));
		};
		try {
			await advance(800);
			expect(view.container.textContent).toContain(
				WEATHER_MEDIA_STRINGS[locale].clock.weatherSetCity,
			);
			expect(view.container.textContent).not.toContain(
				WEATHER_MEDIA_STRINGS[locale].clock.weatherLoading,
			);
			expect(
				view.container
					.querySelector(".oq-weather-card")
					?.getAttribute("aria-busy"),
			).toBe("false");
			weather.request.mockImplementation(async (command) =>
				command._tag === "weather"
					? {
							_tag: "weather",
							result: { _tag: "error", reason: "unavailable" },
						}
					: { _tag: "rejected", reason: "unavailable" },
			);
			await view.render(content(configured));
			await advance(50);
			expect(view.container.textContent).toContain(
				WEATHER_MEDIA_STRINGS[locale].clock.weatherUnavailable,
			);
			expect(
				view.container
					.querySelector(".oq-weather-card")
					?.getAttribute("aria-busy"),
			).toBe("false");
			weather.request.mockImplementation(async (command) =>
				command._tag === "weather"
					? {
							_tag: "weather",
							result: {
								_tag: "ready",
								data: {
									city: "London",
									temperature: 12,
									high: 15,
									low: 7,
									weatherCode: 2,
									description: "Cloudy",
									stale: false,
									provider: "open-meteo",
								},
								refreshAfterMs: 1800000,
							},
						}
					: { _tag: "rejected", reason: "unavailable" },
			);
			await view.render(content({ ...configured, city: "London" }));
			await advance(50);
			expect(view.container.textContent).toContain("London");
			expect(view.container.textContent).toContain("12");
			expect(view.container.textContent).not.toContain(
				WEATHER_MEDIA_STRINGS[locale].clock.weatherLoading,
			);
		} finally {
			await view.unmount();
		}
	},
);
