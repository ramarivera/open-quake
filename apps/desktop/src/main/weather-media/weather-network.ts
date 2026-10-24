import { Context, Effect, Layer } from "effect";
import {
	WeatherNetworkFailed,
	WeatherRequestTimedOut,
} from "../../shared/weather-media-errors";

/** The only network capability. Tests provide a recording fake. */
export class WeatherNetwork extends Context.Tag("WeatherNetwork")<
	WeatherNetwork,
	{
		readonly json: (
			url: string,
		) => Effect.Effect<unknown, WeatherNetworkFailed | WeatherRequestTimedOut>;
	}
>() {}

export const weatherNetworkLive = Layer.succeed(WeatherNetwork, {
	json: Effect.fn("WeatherNetwork.json")(
		(
			url: string,
		): Effect.Effect<unknown, WeatherNetworkFailed | WeatherRequestTimedOut> =>
			Effect.tryPromise({
				try: async (signal) => {
					const response = await fetch(url, {
						redirect: "error",
						signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
					});
					if (!response.ok || !response.body)
						throw new Error("Weather HTTP request failed");
					const reader = response.body.getReader();
					const chunks: Uint8Array[] = [];
					let bytes = 0;
					try {
						for (;;) {
							const chunk = await reader.read();
							if (chunk.done) break;
							bytes += chunk.value.byteLength;
							if (bytes > 1_048_576)
								throw new Error("Weather response exceeds limit");
							chunks.push(chunk.value);
						}
					} finally {
						await reader.cancel();
					}
					const body: unknown = JSON.parse(
						Buffer.concat(chunks).toString("utf8"),
					);
					return body;
				},
				catch: (cause) =>
					typeof cause === "object" &&
					cause !== null &&
					"name" in cause &&
					cause.name === "TimeoutError"
						? WeatherRequestTimedOut.fromCause(cause)
						: WeatherNetworkFailed.fromCause(cause),
			}),
	),
});
