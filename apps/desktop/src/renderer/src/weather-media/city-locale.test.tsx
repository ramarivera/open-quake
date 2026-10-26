// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppLocaleBridge, LocaleSnapshot } from "../../../shared/locale";
import {
	DEFAULT_WEATHER_SETTINGS,
	type WeatherMediaBridge,
	type WeatherMediaReply,
} from "../../../shared/weather-media-contracts";
import { WEATHER_MEDIA_STRINGS } from "../../../shared/weather-media-strings";
import { input, mount, query } from "../../test/dom";
import { AppLocaleProvider } from "../i18n";
import { ClockEnrichmentSettings } from "./WeatherMediaSettings";

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
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it.each([
	{ phase: "debouncing", elapsed: 300, requestLocale: "de" },
	{ phase: "in flight", elapsed: 600, requestLocale: "en" },
])(
	"preserves a $phase city edit and saves its verification across a locale change",
	async ({ elapsed, requestLocale }) => {
		let snapshot: LocaleSnapshot = { locale: "en", revision: 0 };
		const listeners = new Set<(next: LocaleSnapshot) => void>();
		const bridge: AppLocaleBridge = {
			read: async () => snapshot,
			set: async (locale) => {
				snapshot = { locale, revision: snapshot.revision + 1 };
				for (const listener of listeners) listener(snapshot);
				return snapshot;
			},
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			dispose: async () => {},
		};
		let finish = (_reply: WeatherMediaReply): void => {};
		const response = new Promise<WeatherMediaReply>((resolve) => {
			finish = resolve;
		});
		weather.request.mockImplementation((command) =>
			command._tag === "verifyCity"
				? response
				: Promise.resolve({ _tag: "rejected", reason: "unavailable" }),
		);
		const save = vi.fn(async () => true);
		const view = await mount(
			<AppLocaleProvider bridge={bridge}>
				<ClockEnrichmentSettings
					initial={DEFAULT_WEATHER_SETTINGS}
					onSave={save}
				/>
			</AppLocaleProvider>,
		);
		try {
			const city = query(view.host, 'input[type="text"]', HTMLInputElement);
			await input(city, "Berlin");
			await act(async () => vi.advanceTimersByTime(elapsed));
			await act(async () => {
				await bridge.set("de");
			});
			expect(query(view.host, 'input[type="text"]', HTMLInputElement)).toBe(
				city,
			);
			expect(city.value).toBe("Berlin");
			await act(async () => vi.advanceTimersByTime(600 - elapsed));
			expect(weather.request).toHaveBeenCalledWith({
				_tag: "verifyCity",
				query: "Berlin",
				locale: requestLocale,
			});
			expect(view.host.querySelector('[role="status"]')?.textContent).toBe(
				WEATHER_MEDIA_STRINGS.de.settings.weatherCityChecking,
			);
			const location = {
				name: "Berlin",
				country: "DE",
				lat: 52.52,
				lon: 13.405,
				sourceCity: "Berlin",
			};
			await act(async () => {
				finish({ _tag: "city", result: { _tag: "matched", location } });
			});
			expect(save.mock.calls).toEqual([[{ city: "Berlin", location }]]);
			expect(view.host.querySelector('[role="status"]')?.textContent).toBe(
				WEATHER_MEDIA_STRINGS.de.settings.weatherCityMatch.replace(
					"{name}",
					"Berlin · DE",
				),
			);
			expect(
				weather.request.mock.calls.filter(
					([command]) => command._tag === "verifyCity",
				),
			).toHaveLength(1);
		} finally {
			await view.close();
		}
	},
);
