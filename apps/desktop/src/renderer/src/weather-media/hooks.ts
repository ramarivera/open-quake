import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { normalizeWeatherLocale } from "../../../shared/weather-invariants";
import type {
	WeatherResult,
	WeatherSettings,
} from "../../../shared/weather-media-contracts";
import { useAppLocale } from "../i18n";
import { WeatherMediaClient } from "./client";
import { WeatherRefresh } from "./refresh";

const client = new WeatherMediaClient(
	typeof window === "undefined" ? undefined : window.quakeWeatherMedia,
);
const noSubscribe = () => () => {};
const emptySnapshot = () => null;
export const useWeatherMedia = (enabled = true) => ({
	client,
	snapshot: useSyncExternalStore(
		enabled ? client.subscribe : noSubscribe,
		enabled ? client.getSnapshot : emptySnapshot,
		() => null,
	),
});
export const rendererWeatherLocale = () =>
	normalizeWeatherLocale(
		typeof document === "undefined" ? "en" : document.documentElement.lang,
	);
export function useWeather(
	enabled: boolean,
	override?: WeatherSettings,
	instanceId?: string,
	side: "panel" | "edit" = "panel",
): {
	result: WeatherResult;
	loading: boolean;
} {
	const { snapshot } = useWeatherMedia();
	const [state, setState] = useState<{
		result: WeatherResult;
		loading: boolean;
	}>({ result: { _tag: "empty" }, loading: false });
	const locale = useAppLocale().locale;
	const settings = override ?? snapshot?.settings;
	const refreshRevision = snapshot?.refreshRevision;
	const key = JSON.stringify([enabled, settings, locale, refreshRevision]);
	const latest = useRef(settings);
	latest.current = settings;
	const scheduler = useRef<WeatherRefresh | null>(null);
	const previousKey = useRef(key);
	const ready = !!settings;
	useEffect(() => {
		if (!enabled || !ready) return;
		const refresh = new WeatherRefresh(
			async () => {
				const reply = await client.request({
					_tag: "weather",
					locale,
					...(latest.current ? { settings: latest.current } : {}),
					...(instanceId ? { instanceId, side } : {}),
				});
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
	}, [enabled, ready, locale, instanceId, side]);
	useEffect(() => {
		if (key !== previousKey.current) {
			previousKey.current = key;
			setState({ result: { _tag: "empty" }, loading: true });
			scheduler.current?.changed();
		}
	}, [key]);
	return state;
}
