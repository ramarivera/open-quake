import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	cycleTheme,
	isThemeId,
	type ThemeId,
} from "../../../../../shared/clock-style";
import type { HourFormat } from "../../../../../shared/display";
import { useAppLocale } from "../../../i18n";
import { stripPaletteProperties } from "../../palette";
import type { ClockMediaSource } from "./backgroundLoader";
import { ClockBackground } from "./ClockBackground";
import { useReducedMotion } from "./clockHooks";
import { CLOCK_STRINGS, normalizeClockLocale } from "./clockStrings";
import { clockDigits, dateLabel, weekdayLabel } from "./clockTime";
import { ThemeNav } from "./ThemeNav";
import { TimeReadout } from "./TimeReadout";
import { type ClockThemeSelect, ThemePreviewController } from "./themePreview";
import "./clock.css";

const palette = stripPaletteProperties();

export const CLOCK_STAGE = { width: 1920, height: 480 } as const;

export interface ClockTileProps {
	readonly widthPx: number;
	readonly heightPx: number;
	readonly now: Date;
	/** Persisted theme: a theme id or "none". Unknown ids read as season. */
	readonly theme: string;
	readonly hourFormat?: HourFormat | undefined;
	/** open-quake option, off by default (approved decision 6). */
	readonly showSeconds?: boolean | undefined;
	/** BCP 47 tag; defaults to the renderer language. */
	readonly locale?: string | undefined;
	/** Defaults to the OS preference and the app's motion setting. */
	readonly reducedMotion?: boolean | undefined;
	/** Custom media per theme, served by opaque app URLs. */
	readonly media?: Partial<Record<ThemeId, ClockMediaSource>> | undefined;
	/** Persists an on-device ◀/▶ choice; a failure rolls the preview back. */
	readonly onThemeSelect?: ClockThemeSelect | undefined;
	readonly onThemeRollback?:
		| ((themeId: ThemeId, reason: string) => void)
		| undefined;
	/** open-quake-lih.7 cards; absent renders nothing. */
	readonly weather?: ReactNode;
	readonly nowPlaying?: ReactNode;
}

function persistedTheme(theme: string): ThemeId | null {
	if (theme === "none") return null;
	return isThemeId(theme) ? theme : "season";
}

/**
 * The desktop clock: a 1920×480 stage scaled to the host, with the date block
 * and theme switcher, the typographic time and the information column.
 */
export function ClockTile({
	widthPx,
	heightPx,
	now,
	theme,
	hourFormat = "24h",
	showSeconds = false,
	locale,
	reducedMotion,
	media,
	onThemeSelect,
	onThemeRollback,
	weather,
	nowPlaying,
}: ClockTileProps): React.JSX.Element {
	const appLocale = useAppLocale().locale;
	const systemReducedMotion = useReducedMotion();
	const reduced = reducedMotion ?? systemReducedMotion;
	const [preview, setPreview] = useState<ThemeId | null>(null);
	const rollback = useRef(onThemeRollback);
	rollback.current = onThemeRollback;
	const [controller] = useState(
		() =>
			new ThemePreviewController(setPreview, (id, reason) =>
				rollback.current?.(id, reason),
			),
	);
	const mounted = useRef(false);
	// A new persisted theme (save echo or another window) ends the preview.
	useEffect(() => {
		void theme;
		if (mounted.current) controller.persisted();
		mounted.current = true;
	}, [theme, controller]);
	useEffect(() => () => controller.dispose(), [controller]);

	const active = preview ?? persistedTheme(theme);
	const lang = normalizeClockLocale(locale ?? appLocale);
	const strings = CLOCK_STRINGS[lang];
	const digits = clockDigits(now, hourFormat, lang);
	const name = active ? strings.themes[active] : "—";
	return (
		<div
			className="oq-clock"
			data-theme={active ?? "none"}
			data-compact={widthPx < 960}
			data-motion={reduced ? "reduce" : "full"}
			style={{ ...palette, width: widthPx, height: heightPx }}
		>
			<div
				className="oq-clock-stage"
				style={{
					...(widthPx < 960
						? {}
						: {
								transform: `scale(${widthPx / CLOCK_STAGE.width}, ${heightPx / CLOCK_STAGE.height})`,
							}),
				}}
			>
				<ClockBackground
					request={
						active
							? { kind: "theme", themeId: active, media: media?.[active] }
							: { kind: "none" }
					}
				/>
				<div className="oq-clock-rail">
					<div className="oq-clock-week">{weekdayLabel(now, lang)}</div>
					<div className="oq-clock-date">{dateLabel(now, lang)}</div>
					<ThemeNav
						name={name}
						previousLabel={strings.themePrev}
						nextLabel={strings.themeNext}
						onCycle={(delta) =>
							controller.select(cycleTheme(active, delta), onThemeSelect)
						}
					/>
				</div>
				<TimeReadout digits={digits} showSeconds={showSeconds} />
				<div
					className="oq-clock-cards"
					data-count={[weather, nowPlaying].filter(Boolean).length}
				>
					{weather ? (
						<div className="oq-clock-card-slot" data-card="weather">
							{weather}
						</div>
					) : null}
					{nowPlaying ? (
						<div className="oq-clock-card-slot" data-card="now-playing">
							{nowPlaying}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
