import { useEffect, useId, useRef, useState } from "react";
import type { ClockCommand } from "../../../../../shared/clock-contracts";
import { THEME_IDS } from "../../../../../shared/clock-style";
import {
	Callout,
	Group,
	Row,
	Segmented,
	type SegmentOption,
} from "../../../ui/Form";
import { useWallpaper } from "../../../wallpaper/useWallpaper";
import { themeArtUrl } from "./art";
import { ClockTile } from "./ClockTile";
import { useClockNow } from "./clockHooks";
import { CLOCK_STRINGS, normalizeClockLocale } from "./clockStrings";
import { probeVideoDuration } from "./probeVideo";
import { mediaOf, themeOf, useClockSettings } from "./useClockSettings";
import "./clockSettings.css";

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

/**
 * Management "Desktop clock" settings on the Screen page: live preview,
 * Theme / None, the seconds option, and theme cards with custom media. Every
 * change saves at once and reaches the strip through the snapshot broadcast
 * (WIDGETS-056/058/059). Hour format stays in the Clock group above.
 */
export function ClockSettings(): React.JSX.Element {
	const { snapshot, available, request, selectTheme } = useClockSettings();
	const { snapshot: wallpaper } = useWallpaper();
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
			}
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
				description="The DK-Desktop-Clock profile's flip clock. The ◀ and ▶ buttons on the strip switch and save the theme too."
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
							hourFormat={wallpaper?.saved.clock.actions[0].value ?? "24h"}
							showSeconds={snapshot.showSeconds}
							media={mediaOf(snapshot)}
							onThemeSelect={selectTheme}
						/>
					) : null}
				</div>
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
				<Row
					label="Seconds"
					labelId={`${ids}-seconds`}
					hint="DK-Suite shows minutes only."
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
				title="Themes"
				description="Built-in art, or your own image or video (at least 2 seconds) per theme."
			>
				<ul className="clock-theme-cards">
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
								<button
									type="button"
									className="clock-theme-thumb"
									aria-pressed={selected}
									disabled={disabled}
									onClick={() =>
										void run({
											_tag: "setTheme",
											keyCode: snapshot?.keyCode ?? "1,1",
											themeId: id,
										})
									}
								>
									{media?.available && media.kind === "image" ? (
										<img src={media.url} alt="" />
									) : media?.available && media.kind === "video" ? (
										<video src={media.url} muted preload="metadata" />
									) : (
										<img src={themeArtUrl(id)} alt="" />
									)}
									<span className="clock-theme-name">
										{selected ? "✓ " : ""}
										{strings.themes[id]}
									</span>
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
								</button>
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
		</div>
	);
}
