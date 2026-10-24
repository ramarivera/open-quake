import { describe, expect, it, vi } from "vitest";
import {
	CLOCK_LOCALES,
	CLOCK_STRINGS,
	normalizeClockLocale,
} from "./clockStrings";
import {
	clockDigits,
	dateLabel,
	msUntilNextTick,
	weekdayLabel,
} from "./clockTime";

const at = (h: number, m: number, s = 0, ms = 0): Date =>
	new Date(2025, 8, 4, h, m, s, ms); // Thursday 4 September 2025

describe("hour format (WIDGETS-022)", () => {
	it("shows midnight as 12 AM in 12h and 00 in 24h", () => {
		expect(clockDigits(at(0, 5), "12h")).toMatchObject({
			hourTens: 1,
			hourOnes: 2,
			minuteTens: 0,
			minuteOnes: 5,
			meridiem: "AM",
		});
		expect(clockDigits(at(0, 5), "24h")).toMatchObject({
			hourTens: 0,
			hourOnes: 0,
			meridiem: "",
		});
	});

	it("keeps DK-Suite's leading zero in 12h", () => {
		expect(clockDigits(at(9, 5), "12h")).toMatchObject({
			hourTens: 0,
			hourOnes: 9,
			meridiem: "AM",
		});
	});

	it("switches to PM at noon", () => {
		expect(clockDigits(at(12, 5), "12h")).toMatchObject({
			hourTens: 1,
			hourOnes: 2,
			meridiem: "PM",
		});
		expect(clockDigits(at(23, 59), "12h")).toMatchObject({
			hourTens: 1,
			hourOnes: 1,
			meridiem: "PM",
		});
		expect(clockDigits(at(12, 5), "24h").meridiem).toBe("");
	});

	it("pads seconds", () => {
		expect(clockDigits(at(10, 7, 4), "24h").seconds).toBe("04");
	});
});

describe("date rail labels (WIDGETS-024/025/063)", () => {
	it("uses DK-Suite's weekday tables", () => {
		expect(weekdayLabel(at(10, 0), "en")).toBe("THU");
		expect(weekdayLabel(at(10, 0), "de")).toBe(CLOCK_STRINGS.de.weekdays[4]);
		expect(weekdayLabel(new Date(2025, 8, 7), "zh")).toBe("星期日");
		for (const locale of CLOCK_LOCALES)
			expect(CLOCK_STRINGS[locale].weekdays).toHaveLength(7);
	});

	it("upper-cases the short month for Latin locales and has no year", () => {
		expect(dateLabel(at(10, 0), "en")).toBe("SEP 4");
		expect(dateLabel(at(10, 0), "en")).not.toContain("2025");
	});

	it("uses the long month and day for CJK locales", () => {
		expect(dateLabel(at(10, 0), "ja")).toBe("9月4日");
		expect(dateLabel(at(10, 0), "zh")).toBe("9月4日");
		expect(dateLabel(at(10, 0), "ko")).toBe("9월 4일");
	});

	it("normalizes renderer languages to DK's eight locales", () => {
		expect(normalizeClockLocale("zh-CN")).toBe("zh");
		expect(normalizeClockLocale("fr_FR")).toBe("fr");
		expect(normalizeClockLocale("pt-BR")).toBe("en");
		expect(normalizeClockLocale(undefined)).toBe("en");
	});

	it("names the themes verbatim", () => {
		expect(CLOCK_STRINGS.en.themes).toEqual({
			season: "Season",
			cyber: "Cyberpunk",
			anime: "Anime",
			tactical: "Tactical",
			aurora: "Aurora",
		});
		expect(CLOCK_STRINGS.en.themePrev).toBe("Previous theme");
		expect(CLOCK_STRINGS.en.settings.themeChange).toBe("Change background");
	});
});

describe("boundary scheduling (WIDGETS-029/030)", () => {
	it("waits for the next minute when seconds are hidden", () => {
		expect(msUntilNextTick(at(10, 7, 42, 300), false)).toBe(17_700);
		expect(msUntilNextTick(at(23, 59, 59, 999), false)).toBe(1);
	});

	it("keeps positive delays in New York's repeated fall-back hour", () => {
		vi.stubEnv("TZ", "America/New_York");
		try {
			const now = new Date("2026-11-01T06:15:30Z");
			expect(now.getHours()).toBe(1);
			expect(now.getTimezoneOffset()).toBe(300);
			expect(msUntilNextTick(now, false)).toBe(30_000);
			expect(msUntilNextTick(now, true)).toBe(1000);
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("waits for the next second when seconds are shown", () => {
		expect(msUntilNextTick(at(10, 7, 42, 300), true)).toBe(700);
		expect(msUntilNextTick(at(10, 7, 42, 0), true)).toBe(1000);
	});
});
