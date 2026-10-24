import type { HourFormat } from "../../../../../shared/display";
import { CLOCK_STRINGS, type ClockLocale } from "./clockStrings";

export interface ClockDigits {
	readonly hourTens: number;
	readonly hourOnes: number;
	readonly minuteTens: number;
	readonly minuteOnes: number;
	/** Two digits, "00"–"59". */
	readonly seconds: string;
	/** Empty in 24h. */
	readonly meridiem: string;
}

/** `dkDesktopClock.vue:190-204`: hours are always two digits, 0 → 12 in 12h. */
export function clockDigits(
	now: Date,
	format: HourFormat,
	locale: ClockLocale = "en",
): ClockDigits {
	const hour = now.getHours();
	const minute = now.getMinutes();
	const shown = format === "12h" ? hour % 12 || 12 : hour;
	const strings = CLOCK_STRINGS[locale];
	return {
		hourTens: Math.floor(shown / 10),
		hourOnes: shown % 10,
		minuteTens: Math.floor(minute / 10),
		minuteOnes: minute % 10,
		seconds: String(now.getSeconds()).padStart(2, "0"),
		meridiem: format === "12h" ? (hour < 12 ? strings.am : strings.pm) : "",
	};
}

export function weekdayLabel(now: Date, locale: ClockLocale): string {
	return CLOCK_STRINGS[locale].weekdays[now.getDay()] ?? "";
}

/**
 * `dkDesktopClock.vue:213-232`: zh/ja/ko use the locale's long month and day
 * (9月4日 / 9월 4일); everyone else gets the upper-cased short month and day
 * (SEP 4). No year.
 */
export function dateLabel(now: Date, locale: ClockLocale): string {
	try {
		if (locale === "zh" || locale === "ja" || locale === "ko")
			return now.toLocaleDateString(locale, { month: "long", day: "numeric" });
		const month = now.toLocaleDateString(locale, { month: "short" });
		return `${month.toUpperCase()} ${now.getDate()}`;
	} catch {
		return `${now.getMonth() + 1}月${now.getDate()}日`;
	}
}

/**
 * Milliseconds until the next label change: the next minute (DK-Suite takes
 * the earliest of minute, hour and day, which is always the minute) or, while
 * seconds are shown, the next second. Never negative.
 */
export function msUntilNextTick(now: Date, seconds: boolean): number {
	return seconds
		? 1000 - now.getMilliseconds()
		: 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();
}
