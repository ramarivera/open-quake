import {
	DEFAULT_WEATHER_SETTINGS,
	type MediaSession,
	type WeatherSettings,
} from "../../shared/weather-media-contracts";

export const berlin = {
	lat: 52.52,
	lon: 13.405,
	name: "Berlin",
	country: "Germany",
	sourceCity: "Berlin",
};
export const weatherSettings: WeatherSettings = {
	...DEFAULT_WEATHER_SETTINGS,
	enabled: true,
	city: "Berlin",
	location: berlin,
};
export const forecastFixture = {
	current: { temperature_2m: 12.4, weather_code: 2 },
	daily: { temperature_2m_max: [15.4], temperature_2m_min: [7.1] },
};
export const cityFixture = {
	results: [
		{
			latitude: 52.52,
			longitude: 13.405,
			name: "Berlin",
			country: "Germany",
			country_code: "DE",
			feature_code: "PPLC",
		},
	],
};
export const mediaSession: MediaSession = {
	id: "track-1",
	appName: "Music",
	appId: "com.apple.Music",
	title: "A walk through the city",
	artist: "Open Quake Ensemble",
	coverUrl: null,
	playing: true,
	durationMs: 180_000,
	positionMs: 60_000,
	canPrevious: true,
	canNext: true,
	canPlay: true,
	canPause: true,
};
