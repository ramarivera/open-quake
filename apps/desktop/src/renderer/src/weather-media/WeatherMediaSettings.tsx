import { Schema } from "effect";
import { useEffect, useId, useRef, useState } from "react";
import {
	ForecastUrl,
	type WeatherSettings,
} from "../../../shared/weather-media-contracts";
import { WEATHER_MEDIA_STRINGS } from "../../../shared/weather-media-strings";
import { Callout, Group, Row } from "../ui/Form";
import { type CityStatus, CityVerifier } from "./city-verifier";
import { rendererWeatherLocale, useWeatherMedia } from "./hooks";
import "./weather-media.css";

function SettingsFields({
	initial,
}: {
	initial: WeatherSettings;
}): React.JSX.Element {
	const { snapshot, client } = useWeatherMedia();
	const settings = snapshot?.settings ?? initial;
	const locale = rendererWeatherLocale();
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
		void client.configure(patch).then((ok) => setFailure(!ok));
	};
	useEffect(() => {
		const current = new CityVerifier(
			async (query) => {
				const reply = await client.request({
					_tag: "verifyCity",
					query,
					locale,
				});
				return reply?._tag === "city" ? reply.result : { _tag: "network" };
			},
			setStatus,
			(query, result) => {
				void client
					.configure({
						city: query,
						location: result?._tag === "matched" ? result.location : null,
					})
					.then((ok) => setFailure(!ok));
			},
		);
		verifier.current = current;
		return () => {
			current.dispose();
			verifier.current = null;
		};
	}, [client, locale]);
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
			<Group
				title={strings.clockWeatherCard}
				description="Weather and system media cards on your clock."
			>
				{failure ? (
					<Callout tone="warning">
						Settings could not be saved. Please retry.
					</Callout>
				) : null}
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
								if (client.getSnapshot()?.settings.location)
									save({ location: null });
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
				<Row label="Find my city from my IP address">
					<div className="weather-field">
						<input
							type="checkbox"
							checked={settings.ipLookup}
							aria-label="Find my city from my IP address"
							aria-describedby={`${id}-consent`}
							onChange={(event) =>
								save({ ipLookup: event.currentTarget.checked })
							}
						/>
						<p id={`${id}-consent`} className="weather-consent">
							Off by default. With an empty city, this sends your public IP
							address to ipapi.co, or ipwho.is if that fails, to estimate your
							city. Enter a city above to use weather without IP lookup.
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
						System media control is unavailable on this platform. The card shows
						this status until a system media adapter is available.
					</p>
				) : null}
			</Group>
		</div>
	);
}
export function WeatherMediaSettings(): React.JSX.Element | null {
	const { snapshot } = useWeatherMedia();
	return snapshot ? <SettingsFields initial={snapshot.settings} /> : null;
}
