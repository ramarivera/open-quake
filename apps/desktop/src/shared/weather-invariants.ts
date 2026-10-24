import type {
	WeatherData,
	WeatherLocale,
	WeatherSettings,
} from "./weather-media-contracts";

export const WEATHER_GROUPS = {
	clear: [0, 1],
	partlyCloudy: [2],
	cloudy: [3],
	fog: [45, 48],
	drizzle: [51, 53, 55, 56, 57],
	rain: [61, 63, 65, 66, 67, 80, 81, 82],
	snow: [71, 73, 75, 77, 85, 86],
	thunder: [95, 96, 99],
} as const;
export type WeatherGroup = keyof typeof WEATHER_GROUPS | "default";
export function weatherGroup(code: number | null): WeatherGroup {
	for (const [group, codes] of Object.entries(WEATHER_GROUPS)) {
		if (code !== null && codes.some((value) => value === code)) {
			switch (group) {
				case "clear":
				case "partlyCloudy":
				case "cloudy":
				case "fog":
				case "drizzle":
				case "rain":
				case "snow":
				case "thunder":
					return group;
			}
		}
	}
	return "default";
}
export const normalizeWeatherLocale = (locale: string): WeatherLocale => {
	const language = locale.toLowerCase().split(/[-_]/)[0];
	switch (language) {
		case "zh":
		case "fr":
		case "de":
		case "ja":
		case "es":
		case "it":
		case "ko":
			return language;
		default:
			return "en";
	}
};
export const validCityQuery = (query: string): boolean =>
	(query.split(",")[0]?.trim().match(/\p{L}/gu)?.length ?? 0) >= 2;
export const matchingLocation = (settings: WeatherSettings): boolean =>
	settings.location?.sourceCity.trim().toLocaleLowerCase() ===
	settings.city.trim().toLocaleLowerCase();
export const temperatureIn = (
	value: number,
	unit: WeatherSettings["unit"],
): number => Math.round(unit === "fahrenheit" ? (value * 9) / 5 + 32 : value);
export const weatherIn = (
	data: WeatherData,
	unit: WeatherSettings["unit"],
): WeatherData => ({
	...data,
	temperature: temperatureIn(data.temperature, unit),
	high: temperatureIn(data.high, unit),
	low: temperatureIn(data.low, unit),
});
// WWO condition semantics, not its sometimes contradictory icon filenames.
// See main/weather-media/README.md for the source and lossy WMO projections.
export const WTTR_CODES: Readonly<Record<string, number>> = {
	113: 0,
	116: 2,
	119: 3,
	122: 3,
	143: 45,
	176: 80,
	179: 85,
	182: 71,
	185: 56,
	200: 95,
	227: 71,
	230: 75,
	248: 45,
	260: 48,
	263: 51,
	266: 51,
	281: 56,
	284: 57,
	293: 61,
	296: 61,
	299: 63,
	302: 63,
	305: 65,
	308: 65,
	311: 66,
	314: 67,
	317: 71,
	320: 75,
	323: 71,
	326: 71,
	329: 73,
	332: 73,
	335: 75,
	338: 75,
	350: 77,
	353: 80,
	356: 81,
	359: 82,
	362: 85,
	365: 86,
	368: 85,
	371: 86,
	374: 77,
	377: 77,
	386: 95,
	389: 95,
	392: 95,
	395: 95,
};
