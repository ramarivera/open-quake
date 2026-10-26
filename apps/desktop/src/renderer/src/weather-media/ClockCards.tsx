import { useEffect, useState } from "react";
import { canControlMedia } from "../../../shared/media-invariants";
import { weatherGroup } from "../../../shared/weather-invariants";
import type {
	MediaIntent,
	MediaSnapshot,
	WeatherLocale,
	WeatherSettings,
} from "../../../shared/weather-media-contracts";
import { WEATHER_MEDIA_STRINGS } from "../../../shared/weather-media-strings";
import { useAppLocale, useLocaleText } from "../i18n";
import type { ClockWeatherCardProps } from "../strip/tiles/clock/clockCards";
import { useWeather, useWeatherMedia } from "./hooks";
import { TransportButton, TransportGlyph } from "./TransportButton";
import "./weather-media.css";

export function WeatherIcon({
	code,
}: {
	code: number | null;
}): React.JSX.Element {
	const group = weatherGroup(code);
	return (
		<svg
			viewBox="0 0 48 48"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			data-weather-icon={group}
		>
			{group === "clear" ? (
				<>
					<circle cx="24" cy="24" r="10" />
					<path d="M24 3v5m0 32v5M3 24h5m32 0h5M9 9l4 4m22 22 4 4M9 39l4-4m22-22 4-4" />
				</>
			) : (
				<>
					<path d="M12 32a9 9 0 0 1-1-18 13 13 0 0 1 25-1 10 10 0 0 1 0 19H12" />
					{group === "rain" || group === "drizzle" ? (
						<path d="m16 37-2 5m11-5-2 5m11-5-2 5" />
					) : group === "snow" ? (
						<path d="M16 36v8m-4-4h8m10-4v8m-4-4h8" />
					) : group === "thunder" ? (
						<path d="m27 28-7 10h7l-5 9" />
					) : group === "fog" ? (
						<path d="M9 38h30M14 43h20" />
					) : group === "partlyCloudy" ? (
						<path d="M35 3v4m7 3 3-3M41 17h5" />
					) : null}
				</>
			)}
		</svg>
	);
}

export function ClockWeatherCard({
	city,
	unit,
	state,
	locale: requestedLocale,
	loading = state.kind === "loading",
}: ClockWeatherCardProps & {
	locale?: WeatherLocale;
	loading?: boolean;
}): React.JSX.Element {
	const appLocale = useAppLocale().locale;
	const locale = requestedLocale ?? appLocale;
	const t = useLocaleText("clock", locale);
	const strings = WEATHER_MEDIA_STRINGS[locale].clock;
	const ready = state.kind === "ready" ? state : null;
	const text =
		state.kind === "error"
			? state.reason === "city-not-found"
				? strings.weatherCityNotFound
				: strings.weatherUnavailable
			: state.kind === "loading"
				? strings.weatherLoading
				: ready?.description || "—";
	return (
		<div
			className="oq-weather-card"
			data-testid="clock-weather-card"
			aria-busy={loading}
			title={text}
		>
			<div className="oq-weather-badge">
				<WeatherIcon code={ready?.weatherCode ?? null} />
			</div>
			<span className="oq-weather-temp">
				{ready?.temperature ?? "--"}
				<sup>°</sup>
			</span>
			<div className="oq-weather-text">
				<div className="oq-weather-city" title={city}>
					{city || "—"}
				</div>
				<span className="oq-weather-desc" data-error={state.kind === "error"}>
					{text}
				</span>
				<span className="oq-weather-meta">
					°{unit === "fahrenheit" ? "F" : "C"}
					{ready?.stale ? ` · ${t("cached")}` : ""}
				</span>
			</div>
			<div className="oq-weather-range">
				<div>
					<span>{t("high")}</span> {ready?.high ?? "--"}°
				</div>
				<div>
					<span>{t("low")}</span> {ready?.low ?? "--"}°
				</div>
			</div>
		</div>
	);
}

export function ClockMusicCard({
	snapshot,
	control,
	locale: requestedLocale,
}: {
	snapshot: MediaSnapshot;
	control: (intent: MediaIntent) => Promise<boolean>;
	locale?: WeatherLocale;
}): React.JSX.Element {
	const session = snapshot.session;
	const appLocale = useAppLocale().locale;
	const locale = requestedLocale ?? appLocale;
	const strings = WEATHER_MEDIA_STRINGS[locale].clock;
	const [broken, setBroken] = useState(false);
	const [tip, setTip] = useState(false);
	const cover = session?.coverUrl;
	useEffect(() => {
		void cover;
		setBroken(false);
	}, [cover]);
	useEffect(() => {
		if (!tip) return;
		const timer = setTimeout(() => setTip(false), 1800);
		return () => clearTimeout(timer);
	}, [tip]);
	const send = (intent: MediaIntent) => {
		void control(intent).then((accepted) => {
			if (!accepted) setTip(true);
		});
	};
	const disabled = !!snapshot.error || !session?.title;
	return (
		<div
			className="oq-music-card"
			data-testid="clock-music-card"
			data-state={
				snapshot.error
					? "unavailable"
					: !session
						? "idle"
						: session.playing
							? "playing"
							: "paused"
			}
		>
			<div className="oq-music-cover">
				{cover && !broken ? (
					<img src={cover} alt="" onError={() => setBroken(true)} />
				) : (
					<span aria-hidden="true">♪</span>
				)}
			</div>
			<div className="oq-music-meta">
				<div title={session?.title}>{session?.title || "—"}</div>
				{snapshot.error || tip ? (
					<span className="oq-music-tip" role="status">
						{strings.musicUnavailable}
					</span>
				) : (
					<span title={session?.artist}>{session?.artist || "—"}</span>
				)}
			</div>
			<div className="oq-music-controls">
				<TransportButton
					id="clock-music-prev"
					label={strings.musicPrev}
					disabled={disabled || !session?.canPrevious}
					onPress={() => send("previous")}
				>
					<TransportGlyph kind="previous" />
				</TransportButton>
				<TransportButton
					id="clock-music-play"
					className="oq-music-play"
					label={strings.musicPlayPause}
					disabled={disabled || !canControlMedia(snapshot, "toggle")}
					onPress={() => send("toggle")}
				>
					<TransportGlyph kind={session?.playing ? "pause" : "play"} />
				</TransportButton>
				<TransportButton
					id="clock-music-next"
					label={strings.musicNext}
					disabled={disabled || !session?.canNext}
					onPress={() => send("next")}
				>
					<TransportGlyph kind="next" />
				</TransportButton>
			</div>
		</div>
	);
}

export function ClockWeatherSlot({
	settings: ownSettings,
	instanceId,
	side,
}: {
	settings?: WeatherSettings;
	instanceId?: string | undefined;
	side?: "panel" | "edit" | undefined;
} = {}): React.JSX.Element | null {
	const { snapshot } = useWeatherMedia();
	const locale = useAppLocale().locale;
	const settings = ownSettings ?? snapshot?.settings;
	const enabled = settings?.enabled ?? false;
	const { result, loading } = useWeather(
		enabled,
		ownSettings,
		instanceId,
		side,
	);
	if (!enabled || !settings) return null;
	const state: ClockWeatherCardProps["state"] =
		result._tag === "ready"
			? { kind: "ready", ...result.data }
			: result._tag === "error"
				? { kind: "error", reason: result.reason }
				: { kind: "loading" };
	return (
		<ClockWeatherCard
			city={result._tag === "ready" ? result.data.city : settings.city}
			unit={settings.unit}
			state={state}
			locale={locale}
			loading={loading}
		/>
	);
}
export function ClockMusicSlot({
	enabled,
}: {
	enabled?: boolean;
} = {}): React.JSX.Element | null {
	const { snapshot, client } = useWeatherMedia();
	const locale = useAppLocale().locale;
	return snapshot && (enabled ?? snapshot.settings.musicEnabled) ? (
		<ClockMusicCard
			snapshot={snapshot.media}
			control={client.control}
			locale={locale}
		/>
	) : null;
}
