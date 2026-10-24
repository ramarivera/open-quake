import { useEffect, useRef, useState } from "react";
import type { ClockCommand } from "../../../../../shared/clock-contracts";
import { THEME_IDS, type ThemeId } from "../../../../../shared/clock-style";
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

/**
 * Management "Desktop clock" section: live preview, Theme / None, theme
 * cards with custom media, and the seconds option. Every change saves at once
 * and reaches the strip through the snapshot broadcast (WIDGETS-056/058/059).
 */
export function ClockSettings(): React.JSX.Element {
	const { snapshot, available, request, selectTheme } = useClockSettings();
	const { snapshot: wallpaper, request: wallpaperRequest } = useWallpaper();
	const hourFormat = wallpaper?.saved.clock.actions[0].value ?? "24h";
	const strings =
		CLOCK_STRINGS[
			normalizeClockLocale(
				typeof navigator === "undefined" ? "en" : navigator.language,
			)
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
		<section
			className="clock-settings"
			aria-labelledby="clock-settings-heading"
			aria-busy={busy}
		>
			<h2 id="clock-settings-heading">Desktop clock</h2>
			<p className="muted">
				The DK-Desktop-Clock profile on the strip. The ◀ and ▶ buttons on the
				strip switch and save the theme too.
			</p>
			<div ref={previewRef} className="clock-settings-preview">
				{width && snapshot ? (
					<ClockTile
						widthPx={width}
						heightPx={width / 4}
						now={now}
						theme={themeOf(snapshot)}
						hourFormat={hourFormat}
						showSeconds={snapshot.showSeconds}
						media={mediaOf(snapshot)}
						onThemeSelect={selectTheme}
					/>
				) : null}
			</div>
			{!available ? (
				<p className="notice">Open the desktop app to change clock settings.</p>
			) : null}
			{snapshot?.recovered ? (
				<p className="notice">
					Saved clock settings were unreadable, so defaults are shown. Any
					change saves new settings.
				</p>
			) : null}
			<div className="clock-settings-row">
				<label className="clock-settings-format">
					{strings.settings.formatCard}
					<select
						value={hourFormat}
						disabled={busy || !wallpaper}
						onChange={(event) => {
							const saved = wallpaper?.saved;
							const value = event.target.value;
							// Hour format lives with the wallpaper store, which owns it today.
							if (saved && (value === "24h" || value === "12h"))
								void wallpaperRequest({
									_tag: "configure",
									serial: saved.serial,
									revision: saved.revision,
									fillMode: saved.settings.bgFillMode,
									hourFormat: value,
								});
						}}
					>
						<option value="24h">{strings.settings.hourFormat24h}</option>
						<option value="12h">{strings.settings.hourFormat12h}</option>
					</select>
				</label>
				<fieldset className="clock-settings-mode" disabled={disabled}>
					<legend>{strings.settings.themeSection}</legend>
					{(["theme", "none"] as const).map((mode) => (
						<label key={mode}>
							<input
								type="radio"
								name="clock-background-mode"
								value={mode}
								checked={(snapshot?.mode ?? "theme") === mode}
								onChange={() => void run({ _tag: "setMode", mode })}
							/>
							{mode === "theme" ? "Theme" : strings.settings.themeNone}
						</label>
					))}
				</fieldset>
				<label className="clock-settings-seconds">
					<input
						type="checkbox"
						checked={snapshot?.showSeconds ?? false}
						disabled={disabled}
						onChange={(event) =>
							void run({
								_tag: "setSeconds",
								showSeconds: event.target.checked,
							})
						}
					/>
					Show seconds
				</label>
			</div>
			<ul className="clock-theme-cards">
				{THEME_IDS.map((id: ThemeId) => {
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
							<div className="clock-theme-actions">
								<button
									type="button"
									disabled={disabled}
									onClick={() => void run({ _tag: "chooseMedia", themeId: id })}
								>
									{strings.settings.themeChange}
								</button>
								{media ? (
									<button
										type="button"
										disabled={disabled}
										title={strings.settings.themeRestore}
										onClick={() =>
											void run({ _tag: "restoreMedia", themeId: id })
										}
									>
										↺ {strings.settings.themeRestore}
									</button>
								) : null}
							</div>
							{media ? (
								<p className="muted clock-theme-file">
									{media.kind === "video" ? "▶ " : ""}
									{media.name}
								</p>
							) : null}
						</li>
					);
				})}
			</ul>
			<div role="status" aria-live="polite">
				{notice ? <p className="notice">{notice}</p> : null}
			</div>
		</section>
	);
}
