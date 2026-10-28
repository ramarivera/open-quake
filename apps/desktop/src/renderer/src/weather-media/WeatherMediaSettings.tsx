import { Schema } from "effect";
import { useEffect, useId, useRef, useState } from "react";
import {
	ForecastUrl,
	type WeatherSettings,
} from "../../../shared/weather-media-contracts";
import { WEATHER_MEDIA_STRINGS } from "../../../shared/weather-media-strings";
import { useAppLocale, useLocaleText } from "../i18n";
import { Callout, Group, Row } from "../ui/Form";
import { type CityStatus, CityVerifier } from "./city-verifier";
import { useWeatherMedia } from "./hooks";
import { mediaErrorText } from "./PlayerCard";
import "./weather-media.css";

export function ClockEnrichmentSettings({
	initial,
	onSave,
}: {
	initial: WeatherSettings;
	onSave?: ((patch: Partial<WeatherSettings>) => Promise<boolean>) | undefined;
}): React.JSX.Element {
	const { snapshot, client } = useWeatherMedia();
	const settings = onSave ? initial : (snapshot?.settings ?? initial);
	const saveHandler = useRef(onSave);
	saveHandler.current = onSave;
	const locale = useAppLocale().locale;
	const currentLocale = useRef(locale);
	currentLocale.current = locale;
	const t = useLocaleText("clock");
	const strings = WEATHER_MEDIA_STRINGS[locale].settings;
	const id = useId();
	const [city, setCity] = useState(initial.city);
	const [url, setUrl] = useState(initial.forecastUrl);
	const [status, setStatus] = useState<CityStatus>(
		initial.location
			? { _tag: "matched", location: initial.location }
			: { _tag: "idle" },
	);
	const [failure, setFailure] = useState(false);
	const verifier = useRef<CityVerifier | null>(null);
	const save = (patch: Partial<WeatherSettings>): void => {
		void (
			saveHandler.current ? saveHandler.current(patch) : client.configure(patch)
		).then((ok) => setFailure(!ok));
	};
	useEffect(() => {
		const current = new CityVerifier(
			async (query) => {
				const reply = await client.request({
					_tag: "verifyCity",
					query,
					locale: currentLocale.current,
				});
				return reply?._tag === "city" ? reply.result : { _tag: "network" };
			},
			setStatus,
			(query, result) => {
				void (saveHandler.current ?? client.configure)({
					city: query,
					location: result?._tag === "matched" ? result.location : null,
				}).then((ok) => setFailure(!ok));
			},
		);
		verifier.current = current;
		return () => {
			current.dispose();
			verifier.current = null;
		};
	}, [client]);
	const statusText =
		status._tag === "checking"
			? strings.weatherCityChecking
			: status._tag === "matched"
				? strings.weatherCityMatch.replace(
						"{name}",
						`${status.location.name} · ${status.location.country}`,
					)
				: status._tag === "not-found"
					? strings.weatherCityNotFound.replace("{city}", city)
					: status._tag === "network"
						? strings.weatherCityNetworkFail
						: status._tag === "timeout"
							? strings.weatherCityTimeout
							: "";
	return (
		<div className="weather-settings">
			<Group title={strings.clockWeatherCard}>
				{failure ? <Callout tone="warning">{t("saveFailed")}</Callout> : null}
				<Row label={strings.weatherShow}>
					<input
						type="checkbox"
						checked={settings.enabled}
						aria-label={strings.weatherShow}
						onChange={(event) => save({ enabled: event.currentTarget.checked })}
					/>
				</Row>
				<Row label={strings.weatherCity}>
					<div className="weather-field">
						<input
							type="text"
							className="text-field"
							value={city}
							aria-label={strings.weatherCity}
							aria-describedby={`${id}-city-status`}
							placeholder={strings.weatherCityPlaceholder}
							onChange={(event) => {
								const query = event.currentTarget.value;
								setCity(query);
								if (settings.location) save({ location: null });
								verifier.current?.update(query);
							}}
						/>
						<p
							id={`${id}-city-status`}
							className="weather-verification"
							role="status"
							data-error={
								status._tag === "not-found" ||
								status._tag === "network" ||
								status._tag === "timeout"
							}
						>
							{statusText}
						</p>
					</div>
				</Row>
				<Row label={strings.weatherUnit}>
					<select
						className="text-field"
						aria-label={strings.weatherUnit}
						value={settings.unit}
						onChange={(event) => {
							const unit = event.currentTarget.value;
							if (unit === "celsius" || unit === "fahrenheit") save({ unit });
						}}
					>
						<option value="celsius">°C</option>
						<option value="fahrenheit">°F</option>
					</select>
				</Row>
				<Row label={t("ipLookup")}>
					<div className="weather-field">
						<input
							type="checkbox"
							checked={settings.ipLookup}
							aria-label={t("ipLookup")}
							aria-describedby={`${id}-consent`}
							onChange={(event) =>
								save({ ipLookup: event.currentTarget.checked })
							}
						/>
						<p id={`${id}-consent`} className="weather-consent">
							{t("ipConsent")}
						</p>
					</div>
				</Row>
				<Row label={strings.weatherUrl}>
					<div className="weather-field">
						<input
							type="url"
							className="text-field"
							value={url}
							aria-label={strings.weatherUrl}
							aria-invalid={!Schema.is(ForecastUrl)(url)}
							placeholder={strings.weatherUrlPlaceholder}
							onChange={(event) => {
								const value = event.currentTarget.value;
								setUrl(value);
								if (Schema.is(ForecastUrl)(value)) save({ forecastUrl: value });
							}}
						/>
						{!Schema.is(ForecastUrl)(url) ? (
							<p className="weather-verification" role="alert">
								{strings.weatherUrlInvalid}
							</p>
						) : null}
						<button
							type="button"
							className="button"
							data-variant="quiet"
							onClick={() => {
								setUrl("");
								save({ forecastUrl: "" });
							}}
						>
							{strings.weatherUrlReset}
						</button>
					</div>
				</Row>
			</Group>
			<Group title={strings.clockMusicCard}>
				<Row label={strings.clockMusicEnabled}>
					<input
						type="checkbox"
						checked={settings.musicEnabled}
						aria-label={strings.clockMusicEnabled}
						onChange={(event) =>
							save({ musicEnabled: event.currentTarget.checked })
						}
					/>
				</Row>
				{snapshot?.media.error ? (
					<p className="weather-consent">
						{mediaErrorText(snapshot.media, locale)}
					</p>
				) : null}
			</Group>
		</div>
	);
}
export function WeatherMediaSettings(): React.JSX.Element | null {
	const { snapshot } = useWeatherMedia();
	return snapshot ? (
		<ClockEnrichmentSettings initial={snapshot.settings} />
	) : null;
}
