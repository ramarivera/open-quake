import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { normalizeWeatherLocale } from "../../../shared/weather-invariants";
import type { WeatherResult } from "../../../shared/weather-media-contracts";
import { WeatherMediaClient } from "./client";
import { WeatherRefresh } from "./refresh";

const client = new WeatherMediaClient(
	typeof window === "undefined" ? undefined : window.quakeWeatherMedia,
);
export const useWeatherMedia = () => ({
	client,
	snapshot: useSyncExternalStore(
		client.subscribe,
		client.getSnapshot,
		() => null,
	),
});
export const rendererWeatherLocale = () =>
	normalizeWeatherLocale(
		typeof navigator === "undefined" ? "en" : navigator.language,
	);
export function useWeather(enabled: boolean): {
	result: WeatherResult;
	loading: boolean;
} {
	const { snapshot } = useWeatherMedia();
	const [state, setState] = useState<{
		result: WeatherResult;
		loading: boolean;
	}>({ result: { _tag: "empty" }, loading: false });
	const locale = rendererWeatherLocale();
	const settings = snapshot?.settings;
	const key = JSON.stringify([enabled, settings, locale]);
	const latest = useRef(settings);
	latest.current = settings;
	const scheduler = useRef<WeatherRefresh | null>(null);
	const previousKey = useRef(key);
	const ready = !!settings;
	useEffect(() => {
		if (!enabled || !ready) return;
		const refresh = new WeatherRefresh(
			async () => {
				const reply = await client.request({ _tag: "weather", locale });
				return reply?._tag === "weather"
					? reply.result
					: { _tag: "error", reason: "unavailable" };
			},
			(result) =>
				setState((previous) =>
					result === "loading"
						? { ...previous, loading: true }
						: { result, loading: false },
				),
			() => !document.hidden,
			() => !latest.current?.city.trim() && !!latest.current?.ipLookup,
		);
		scheduler.current = refresh;
		const visibility = () => refresh.visibilityChanged();
		document.addEventListener("visibilitychange", visibility);
		return () => {
			refresh.dispose();
			scheduler.current = null;
			document.removeEventListener("visibilitychange", visibility);
		};
	}, [enabled, ready, locale]);
	useEffect(() => {
		if (key !== previousKey.current) {
			previousKey.current = key;
			setState({ result: { _tag: "empty" }, loading: true });
			scheduler.current?.changed();
		}
	}, [key]);
	return state;
}
