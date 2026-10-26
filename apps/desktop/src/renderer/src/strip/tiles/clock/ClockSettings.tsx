import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
	ClockCommand,
	ClockTarget,
} from "../../../../../shared/clock-contracts";
import { THEME_IDS } from "../../../../../shared/clock-style";
import type { WeatherSettings } from "../../../../../shared/weather-media-contracts";
import {
	Callout,
	Group,
	Row,
	Segmented,
	type SegmentOption,
} from "../../../ui/Form";
import { selectStripPage } from "../../selection";
import { useStripProfiles } from "../../useStripProfiles";
import { ClockTile } from "./ClockTile";
import { useClockNow } from "./clockHooks";
import { CLOCK_STRINGS, normalizeClockLocale } from "./clockStrings";
import { probeVideoDuration } from "./probeVideo";
import { ThemeThumbnail } from "./ThemeThumbnail";
import { mediaOf, themeOf, useClockSettings } from "./useClockSettings";
import "./clockSettings.css";
import {
	ClockMusicSlot,
	ClockWeatherSlot,
} from "../../../weather-media/ClockCards";
import { ClockEnrichmentSettings } from "../../../weather-media/WeatherMediaSettings";

function usePreviewWidth(
	ref: React.RefObject<HTMLElement | null>,
): number | undefined {
	const [width, setWidth] = useState<number>();
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const update = (): void => setWidth(element.clientWidth);
		const observer = new ResizeObserver(update);
		observer.observe(element);
		update();
		return () => observer.disconnect();
	}, [ref]);
	return width;
}

const secondsOptions: ReadonlyArray<SegmentOption<"off" | "on">> = [
	{ value: "off", label: "Off" },
	{ value: "on", label: "On" },
];

/** Use the same serial-scoped page as StripScreen; never edit a different profile. */
export function ScreenClockSettings({
	serial,
}: {
	serial: string | undefined;
}): React.JSX.Element | null {
	const profiles = useStripProfiles();
	if (profiles._tag !== "ready") return null;
	const { profile, page } = selectStripPage(profiles.envelope, serial);
	const key = page.keys.find((key) => key.config.type === "dkDesktopClock");
	return key ? (
		<ClockSettings
			target={{ profileId: profile.id, pageId: page.id, keyCode: key.keyCode }}
		/>
	) : null;
}

/**
 * Management "Desktop clock" settings on the Screen page: live preview,
 * Theme / None, the seconds option, and theme cards with custom media. Every
 * change saves at once and reaches the strip through the snapshot broadcast
 * (WIDGETS-022/056/058/059). The selected profile key owns every setting.
 */
export function ClockSettings({
	target,
	onSaved,
	beforeWrite,
	draftHourFormat,
	onHourFormat,
}: {
	target?: ClockTarget | undefined;
	draftHourFormat?: "12h" | "24h" | undefined;
	onHourFormat?: ((value: "12h" | "24h") => void) | undefined;
	onSaved?: (() => void) | undefined;
	beforeWrite?: (() => Promise<boolean>) | undefined;
}): React.JSX.Element {
	const {
		snapshot,
		available,
		request,
		selectTheme: saveTheme,
	} = useClockSettings(undefined, target, beforeWrite);
	// Replies become the next patch's base before React renders. A quick unit
	// change must retain the city saved just before it on this same key.
	const enrichment = useMemo<{
		request: typeof request;
		tail: Promise<void>;
		settings: WeatherSettings | undefined;
	}>(
		() => ({ request, tail: Promise.resolve(), settings: undefined }),
		[request],
	);
	if (snapshot?.weather) enrichment.settings = snapshot.weather;
	const selectTheme: typeof saveTheme = async (themeId) => {
		const result = await saveTheme(themeId);
		if (result.ok) onSaved?.();
		return result;
	};

	const ids = useId();
	const strings =
		CLOCK_STRINGS[
			normalizeClockLocale(
				typeof navigator === "undefined" ? "en" : navigator.language,
			)
		];
	const modeOptions: ReadonlyArray<SegmentOption<"theme" | "none">> = [
		{ value: "theme", label: "Theme" },
		{ value: "none", label: strings.settings.themeNone },
	];
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState("");
	const previewRef = useRef<HTMLDivElement>(null);
	const width = usePreviewWidth(previewRef);
	const now = useClockNow(snapshot?.showSeconds ?? false);
	const run = async (command: ClockCommand): Promise<void> => {
		setBusy(true);
		setNotice("");
		try {
			const reply = await request(command);
			if (!reply) {
				setNotice("Clock service is unavailable. Reload the window.");
				return;
			}
			if (reply._tag === "failure") {
				setNotice(reply.message);
				return;
			}
			if (reply._tag === "candidate") {
				const duration = await probeVideoDuration(reply.url);
				if (duration === null) {
					setNotice(strings.settings.mediaUnusable);
					return;
				}
				const committed = await request({
					_tag: "commitMedia",
					token: reply.token,
					durationMs: duration,
				});
				if (committed?._tag === "failure") setNotice(committed.message);
				if (committed?._tag === "success") onSaved?.();
			}
			if (reply._tag === "success") onSaved?.();
		} finally {
			setBusy(false);
		}
	};
	const active = snapshot ? themeOf(snapshot) : "season";
	const disabled = busy || !snapshot;
	return (
		<div className="page clock-settings" aria-busy={busy}>
			<Group
				title="Desktop clock"
				description="The clock key on your strip. Its ‹ and › buttons switch and save the theme too."
				footer={
					<div role="status" aria-live="polite" className="status-notes">
						{!available ? (
							<Callout tone="warning">
								Open the desktop app to change clock settings.
							</Callout>
						) : null}
						{snapshot?.recovered ? (
							<Callout tone="warning">
								Saved clock settings couldn't be read, so defaults are shown.
								Any change saves new settings.
							</Callout>
						) : null}
						{notice ? <Callout tone="warning">{notice}</Callout> : null}
					</div>
				}
			>
				<div ref={previewRef} className="clock-settings-preview">
					{width && snapshot ? (
						<ClockTile
							widthPx={width}
							heightPx={width / 4}
							now={now}
							theme={themeOf(snapshot)}
							hourFormat={draftHourFormat ?? snapshot.hourFormat ?? "24h"}
							showSeconds={snapshot.showSeconds}
							media={mediaOf(snapshot)}
							onThemeSelect={selectTheme}
							weather={
								snapshot.weather?.enabled ? (
									<ClockWeatherSlot
										settings={snapshot.weather}
										instanceId={JSON.stringify(target)}
										side="edit"
									/>
								) : undefined
							}
							nowPlaying={
								snapshot.musicEnabled ? <ClockMusicSlot enabled /> : undefined
							}
						/>
					) : null}
				</div>
			</Group>
			<Group title={strings.settings.formatCard}>
				<Row label={strings.settings.formatCard} labelId={`${ids}-format`}>
					<Segmented
						name={`${ids}-format`}
						labelledBy={`${ids}-format`}
						value={draftHourFormat ?? snapshot?.hourFormat ?? "24h"}
						options={[
							{ value: "24h", label: strings.settings.hourFormat24h },
							{ value: "12h", label: strings.settings.hourFormat12h },
						]}
						disabled={disabled}
						onChange={(hourFormat) =>
							onHourFormat
								? onHourFormat(hourFormat)
								: void run({ _tag: "setHourFormat", hourFormat })
						}
					/>
				</Row>
				<Row
					label="Seconds"
					labelId={`${ids}-seconds`}
					hint="Off shows hours and minutes only."
				>
					<Segmented
						name={`${ids}-seconds`}
						labelledBy={`${ids}-seconds`}
						value={snapshot?.showSeconds ? "on" : "off"}
						options={secondsOptions}
						disabled={disabled}
						onChange={(value) =>
							void run({ _tag: "setSeconds", showSeconds: value === "on" })
						}
					/>
				</Row>
			</Group>

			<Group
				title={strings.settings.themeSection}
				description="Built-in art, or your own image or video (at least 2 seconds) per theme."
			>
				<Row label={strings.settings.themeSection} labelId={`${ids}-mode`}>
					<Segmented
						name={`${ids}-mode`}
						labelledBy={`${ids}-mode`}
						value={snapshot?.mode ?? "theme"}
						options={modeOptions}
						disabled={disabled}
						onChange={(mode) => void run({ _tag: "setMode", mode })}
					/>
				</Row>
				<ul
					className="clock-theme-cards"
					aria-label={strings.settings.themeSection}
				>
					{THEME_IDS.map((id) => {
						const media = snapshot?.media[id];
						const selected = active === id;
						return (
							<li
								key={id}
								className="clock-theme-card"
								data-theme={id}
								data-selected={selected}
							>
								<label className="clock-theme-thumb" data-disabled={disabled}>
									<input
										className="clock-theme-radio"
										type="radio"
										name={`${ids}-theme`}
										checked={selected}
										aria-label={strings.themes[id]}
										disabled={disabled}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												event.preventDefault();
												event.currentTarget.click();
											}
										}}
										onChange={() =>
											void run({
												_tag: "setTheme",
												keyCode: snapshot?.keyCode ?? "1,1",
												themeId: id,
											})
										}
									/>
									<ThemeThumbnail themeId={id} media={media} />
									{media ? (
										<span className="clock-theme-badge">
											✦ {strings.settings.themeOverrideBadge}
										</span>
									) : null}
									{media && !media.available ? (
										<span
											className="clock-theme-missing"
											title={strings.settings.mediaUnusable}
										>
											!
										</span>
									) : null}
								</label>
								<span className="clock-theme-name">
									{strings.themes[id]}
									{selected ? (
										<span className="clock-theme-selected"> · Selected</span>
									) : null}
								</span>
								<div className="button-row">
									<button
										type="button"
										className="button"
										disabled={disabled}
										onClick={() =>
											void run({ _tag: "chooseMedia", themeId: id })
										}
									>
										{strings.settings.themeChange}
									</button>
									{media ? (
										<button
											type="button"
											className="button"
											disabled={disabled}
											title={strings.settings.themeRestore}
											aria-label={`${strings.settings.themeRestore}: ${strings.themes[id]}`}
											onClick={() =>
												void run({ _tag: "restoreMedia", themeId: id })
											}
										>
											↺
										</button>
									) : null}
								</div>
								{media ? (
									<p className="clock-theme-file">
										{media.kind === "video" ? "▶ " : ""}
										{media.name}
									</p>
								) : null}
							</li>
						);
					})}
				</ul>
			</Group>
			{snapshot?.weather ? (
				<ClockEnrichmentSettings
					key={JSON.stringify(target)}
					initial={snapshot.weather}
					onSave={async (patch) => {
						const pending = enrichment.tail.then(async () => {
							const settings = enrichment.settings;
							if (!settings) return false;
							const reply = await request(
								patch.musicEnabled !== undefined
									? { _tag: "setMusic", enabled: patch.musicEnabled }
									: { _tag: "setWeather", settings: { ...settings, ...patch } },
							);
							if (reply?._tag !== "success") return false;
							enrichment.settings = reply.snapshot.weather;
							onSaved?.();
							await window.quakeWeatherMedia?.request({
								_tag: "configChanged",
							});
							return true;
						});
						enrichment.tail = pending.then(
							() => undefined,
							() => undefined,
						);
						return pending;
					}}
				/>
			) : null}
		</div>
	);
}
