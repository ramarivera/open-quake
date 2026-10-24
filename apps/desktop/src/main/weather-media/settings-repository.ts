import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import {
	DEFAULT_WEATHER_SETTINGS,
	WeatherSettings,
} from "../../shared/weather-media-contracts";
import { WeatherPersistenceFailed } from "../../shared/weather-media-errors";

export class WeatherSettingsRepository extends Context.Tag(
	"WeatherSettingsRepository",
)<
	WeatherSettingsRepository,
	{
		readonly load: () => Effect.Effect<
			WeatherSettings,
			WeatherPersistenceFailed
		>;
		readonly save: (
			settings: WeatherSettings,
		) => Effect.Effect<void, WeatherPersistenceFailed>;
	}
>() {}
export const weatherSettingsLive = (
	root: string,
): Layer.Layer<WeatherSettingsRepository> => {
	const file = join(root, "weather-media-v1", "settings.json");
	return Layer.succeed(WeatherSettingsRepository, {
		load: () =>
			Effect.tryPromise({
				try: async () => {
					let text: string;
					try {
						text = await readFile(file, "utf8");
					} catch (cause) {
						if (
							typeof cause === "object" &&
							cause !== null &&
							"code" in cause &&
							cause.code === "ENOENT"
						)
							return DEFAULT_WEATHER_SETTINGS;
						throw cause;
					}
					return Schema.decodeUnknownSync(Schema.parseJson(WeatherSettings))(
						text,
					);
				},
				catch: WeatherPersistenceFailed.fromCause,
			}),
		save: (settings) =>
			Effect.tryPromise({
				try: async () => {
					const valid = Schema.decodeUnknownSync(WeatherSettings)(settings);
					await mkdir(join(root, "weather-media-v1"), { recursive: true });
					const pending = `${file}.${randomUUID()}.pending`;
					try {
						await writeFile(pending, JSON.stringify(valid), { mode: 0o600 });
						await rename(pending, file);
					} finally {
						await rm(pending, { force: true }).catch(() => undefined);
					}
				},
				catch: WeatherPersistenceFailed.fromCause,
			}),
	});
};
