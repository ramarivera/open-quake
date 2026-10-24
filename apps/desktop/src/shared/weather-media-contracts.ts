import { Schema } from "effect";

export const WEATHER_MEDIA_REQUEST = "weather-media:request";
export const WEATHER_MEDIA_CHANGED = "weather-media:changed";
export const WEATHER_REFRESH_MS = 30 * 60 * 1000;
export const WeatherLocale = Schema.Literal(
	"en",
	"zh",
	"fr",
	"de",
	"ja",
	"es",
	"it",
	"ko",
);
export type WeatherLocale = typeof WeatherLocale.Type;
export const WeatherLocation = Schema.Struct({
	lat: Schema.Finite.pipe(Schema.between(-90, 90)),
	lon: Schema.Finite.pipe(Schema.between(-180, 180)),
	name: Schema.String.pipe(Schema.maxLength(200)),
	country: Schema.String.pipe(Schema.maxLength(200)),
	sourceCity: Schema.String.pipe(Schema.maxLength(200)),
});
export type WeatherLocation = typeof WeatherLocation.Type;
export const ForecastUrl = Schema.String.pipe(
	Schema.maxLength(2048),
	Schema.filter((value) => {
		if (!value) return true;
		try {
			const url = new URL(value);
			return (
				(url.protocol === "https:" || url.protocol === "http:") &&
				!url.username &&
				!url.password
			);
		} catch {
			return false;
		}
	}),
);
export const WeatherSettings = Schema.Struct({
	enabled: Schema.Boolean,
	city: Schema.String.pipe(Schema.maxLength(200)),
	location: Schema.NullOr(WeatherLocation),
	unit: Schema.Literal("celsius", "fahrenheit"),
	ipLookup: Schema.Boolean,
	forecastUrl: ForecastUrl,
	musicEnabled: Schema.Boolean,
});
export type WeatherSettings = typeof WeatherSettings.Type;
export const DEFAULT_WEATHER_SETTINGS: WeatherSettings = {
	enabled: false,
	city: "",
	location: null,
	unit: "celsius",
	ipLookup: false,
	forecastUrl: "",
	musicEnabled: false,
};
export const WeatherData = Schema.Struct({
	city: Schema.String,
	temperature: Schema.Finite,
	high: Schema.Finite,
	low: Schema.Finite,
	weatherCode: Schema.NullOr(Schema.Finite),
	description: Schema.String,
	stale: Schema.Boolean,
	provider: Schema.Literal("open-meteo", "wttr.in"),
});
export type WeatherData = typeof WeatherData.Type;
export const WeatherResult = Schema.Union(
	Schema.TaggedStruct("empty", {}),
	Schema.TaggedStruct("ready", { data: WeatherData }),
	Schema.TaggedStruct("error", {
		reason: Schema.Literal("city-not-found", "unavailable"),
	}),
);
export type WeatherResult = typeof WeatherResult.Type;
export const CityResult = Schema.Union(
	Schema.TaggedStruct("matched", { location: WeatherLocation }),
	Schema.TaggedStruct("not-found", {}),
	Schema.TaggedStruct("network", {}),
	Schema.TaggedStruct("timeout", {}),
);
export type CityResult = typeof CityResult.Type;
export const MediaFailure = Schema.Literal(
	"MEDIAREMOTE_UNAVAILABLE",
	"SMTC_UNAVAILABLE",
	"UNSUPPORTED_PLATFORM",
	"TCC_DENIED",
	"TRANSPORT_ERROR",
	"SESSION_LOST",
);
export type MediaFailure = typeof MediaFailure.Type;
export const SafeCoverUrl = Schema.String.pipe(
	Schema.maxLength(3_000_000),
	Schema.pattern(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
);
export const MediaSession = Schema.Struct({
	id: Schema.String.pipe(Schema.maxLength(500)),
	appName: Schema.String.pipe(Schema.maxLength(200)),
	appId: Schema.String.pipe(Schema.maxLength(300)),
	title: Schema.String.pipe(Schema.maxLength(1000)),
	artist: Schema.String.pipe(Schema.maxLength(1000)),
	coverUrl: Schema.NullOr(SafeCoverUrl),
	playing: Schema.Boolean,
	durationMs: Schema.NullOr(Schema.Finite.pipe(Schema.nonNegative())),
	positionMs: Schema.Finite.pipe(Schema.nonNegative()),
	canPrevious: Schema.Boolean,
	canNext: Schema.Boolean,
	canPlay: Schema.Boolean,
	canPause: Schema.Boolean,
});
export type MediaSession = typeof MediaSession.Type;
export const MediaSnapshot = Schema.Struct({
	revision: Schema.Int.pipe(Schema.nonNegative()),
	session: Schema.NullOr(MediaSession),
	error: Schema.NullOr(MediaFailure),
});
export type MediaSnapshot = typeof MediaSnapshot.Type;
export const MediaIntent = Schema.Literal("toggle", "previous", "next");
export type MediaIntent = typeof MediaIntent.Type;
export const WeatherMediaSnapshot = Schema.Struct({
	revision: Schema.Int.pipe(Schema.nonNegative()),
	settings: WeatherSettings,
	media: MediaSnapshot,
});
export type WeatherMediaSnapshot = typeof WeatherMediaSnapshot.Type;
export const WeatherMediaCommand = Schema.Union(
	Schema.TaggedStruct("read", {}),
	Schema.TaggedStruct("configure", { settings: WeatherSettings }),
	Schema.TaggedStruct("verifyCity", {
		query: Schema.String.pipe(Schema.maxLength(200)),
		locale: WeatherLocale,
	}),
	Schema.TaggedStruct("weather", { locale: WeatherLocale }),
	Schema.TaggedStruct("media", { intent: MediaIntent }),
);
export type WeatherMediaCommand = typeof WeatherMediaCommand.Type;
export const WeatherMediaReply = Schema.Union(
	Schema.TaggedStruct("snapshot", { snapshot: WeatherMediaSnapshot }),
	Schema.TaggedStruct("city", { result: CityResult }),
	Schema.TaggedStruct("weather", { result: WeatherResult }),
	Schema.TaggedStruct("control", {
		accepted: Schema.Boolean,
		media: MediaSnapshot,
	}),
	Schema.TaggedStruct("failure", {
		code: Schema.Literal(
			"QUAKE.WEATHER.REQUEST_INVALID",
			"QUAKE.WEATHER.PERSISTENCE_FAILED",
		),
		message: Schema.String,
	}),
);
export type WeatherMediaReply = typeof WeatherMediaReply.Type;
export interface WeatherMediaBridge {
	request(command: WeatherMediaCommand): Promise<unknown>;
	onSnapshot(callback: (snapshot: unknown) => void): () => void;
}
declare global {
	interface Window {
		quakeWeatherMedia?: WeatherMediaBridge;
	}
}
