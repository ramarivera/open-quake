import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClockSnapshot } from "../../../../../shared/clock-contracts";
import { THEME_IDS } from "../../../../../shared/clock-style";
import { themeArtSvg, themeArtUrl } from "./art";
import { ClockTile, type ClockTileProps } from "./ClockTile";
import { mediaOf, newest, themeOf, themeResultOf } from "./useClockSettings";

const now = new Date(2025, 8, 4, 10, 7, 42);
const render = (props: Partial<ClockTileProps> = {}): string =>
	renderToStaticMarkup(
		createElement(ClockTile, {
			widthPx: 1920,
			heightPx: 480,
			now,
			theme: "season",
			locale: "en",
			reducedMotion: false,
			...props,
		}),
	);
const count = (html: string, needle: string): number =>
	html.split(needle).length - 1;

describe("ClockTile static render (WIDGETS-023/026/030/061, §3.1)", () => {
	it("renders DK's 24h layout: four cards, colon, no pills, no cards", () => {
		const html = render();
		expect(count(html, 'class="oq-flip"')).toBe(4);
		expect(count(html, 'data-flip="rest"')).toBe(1);
		expect(count(html, "oq-flip-colon")).toBe(1);
		expect(html).toContain('data-time="10:07"');
		expect(html).not.toContain("oq-flip-pill");
		expect(html).toContain('<div class="oq-clock-cards"></div>');
		expect(html).toContain('class="oq-clock-week">THU<');
		expect(html).toContain('class="oq-clock-date">SEP 4<');
		expect(html).toContain('style="transform:scale(1, 1)"');
	});

	it("adds the AM/PM pill in 12h and the seconds pill only when enabled", () => {
		const twelve = render({ hourFormat: "12h" });
		expect(twelve).toContain('<span class="oq-flip-pill">AM</span>');
		expect(twelve).not.toContain("is-seconds");
		const seconds = render({ hourFormat: "12h", showSeconds: true });
		expect(seconds).toContain(
			'<span class="oq-flip-pill is-seconds">42</span>',
		);
	});

	it("scales the 1920×480 stage to the host without reflowing", () => {
		const html = render({ widthPx: 960, heightPx: 240 });
		expect(html).toContain("width:960px;height:240px");
		expect(html).toContain("transform:scale(0.5, 0.5)");
		expect(render({ widthPx: 1280, heightPx: 400 })).toContain(
			"transform:scale(0.6666666666666666, 0.8333333333333334)",
		);
	});

	it("draws the theme's built-in art, tint and name", () => {
		const html = render({ theme: "cyber" });
		expect(html).toContain('data-theme="cyber"');
		expect(html).toContain('data-source="builtin"');
		expect(html).toContain(themeArtUrl("cyber").slice(0, 60));
		expect(html).toContain(
			'class="oq-clock-nav-name" title="Cyberpunk">Cyberpunk<',
		);
	});

	it("reads unknown themes as season and None as a dash with no media", () => {
		expect(render({ theme: "neon" })).toContain('data-theme="season"');
		const none = render({ theme: "none" });
		expect(none).toContain('data-theme="none"');
		expect(none).toContain('data-background="none"');
		expect(none).toContain(">—<");
		expect(none).not.toContain("<img");
	});

	it("uses custom media for the active theme only", () => {
		const media = {
			cyber: {
				kind: "image" as const,
				url: "oq-clock-media://theme/cyber?r=2",
			},
			aurora: {
				kind: "video" as const,
				url: "oq-clock-media://theme/aurora?r=2",
			},
		};
		expect(render({ theme: "cyber", media })).toContain(
			'src="oq-clock-media://theme/cyber?r=2" alt="" data-source="custom"',
		);
		const video = render({ theme: "aurora", media });
		expect(video).toContain("<video");
		expect(video).toContain('src="oq-clock-media://theme/aurora?r=2"');
		expect(video).toContain("muted");
		expect(render({ theme: "season", media })).toContain(
			'data-source="builtin"',
		);
	});

	it("carries DK's touch contract on the theme buttons", () => {
		const html = render();
		expect(html).toContain('data-quake-sub-touch="clock-theme-prev"');
		expect(html).toContain('data-quake-sub-touch="clock-theme-next"');
		expect(count(html, 'data-support-quake-move="false"')).toBe(2);
		expect(html).toContain('aria-label="Previous theme"');
		expect(html).toContain('aria-label="Next theme"');
	});

	it("places supplied cards in order and nothing else", () => {
		const html = render({
			weather: createElement("i", null, "w"),
			nowPlaying: createElement("i", null, "n"),
		});
		expect(html).toContain(
			'<div class="oq-clock-cards"><div class="oq-clock-card-slot" data-card="weather"><i>w</i></div><div class="oq-clock-card-slot" data-card="now-playing"><i>n</i></div></div>',
		);
	});

	it("marks reduced motion on the root", () => {
		expect(render({ reducedMotion: true })).toContain('data-motion="reduce"');
	});
});

describe("DK geometry and tokens in clock.css (WIDGETS-026/027/032/036/037)", () => {
	const css = readFileSync(new URL("./clock.css", import.meta.url), "utf8");
	const rule = (selector: string): string => {
		// The rule that starts with exactly this selector, not a selector list.
		const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const start = css.search(new RegExp(`(?<!,)\\n${escaped} \\{`));
		expect(start, selector).toBeGreaterThanOrEqual(0);
		return css.slice(start, css.indexOf("}", start));
	};

	it("keeps the flip card and digit geometry", () => {
		expect(rule(".oq-flip")).toMatch(/width: 160px;\s+height: 300px;/);
		expect(rule(".oq-flip-clock")).toContain("gap: 14px");
		expect(rule(".oq-flip-upper")).toContain(
			"border-radius: 22px 22px 8px 8px",
		);
		expect(rule(".oq-flip-lower")).toContain(
			"border-radius: 8px 8px 22px 22px",
		);
		expect(rule(".oq-flip-digit")).toMatch(
			/font-size: 260px;\s+font-weight: 100;/,
		);
		expect(rule(".oq-flip-colon")).toMatch(/gap: 34px;\s+height: 300px;/);
		expect(css).toContain("0.38s cubic-bezier(0.45, 0.05, 0.55, 0.95)");
		expect(css).toContain("rotateX(-92deg)");
		expect(css).toContain("rotateX(92deg)");
	});

	it("keeps the stage, rail, nav and right slot", () => {
		expect(rule(".oq-clock-stage")).toContain("padding: 0 64px");
		expect(rule(".oq-clock-rail")).toMatch(
			/margin-left: 16px;\s+width: 240px;\s+height: 300px;/,
		);
		expect(rule(".oq-clock-nav")).toContain("gap: 18px");
		expect(rule(".oq-clock-nav-btn")).toMatch(/width: 54px;\s+height: 54px;/);
		expect(rule(".oq-clock-nav-name")).toContain("width: 132px");
		expect(rule(".oq-clock-cards")).toMatch(
			/margin-right: 16px;[\s\S]*gap: 20px;/,
		);
		expect(rule(".oq-clock-nav-btn")).toContain(
			"transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1)",
		);
		expect(css).toContain("transition-duration: 90ms");
	});

	it("keeps the glass base, tints and scrim", () => {
		expect(css).toContain("--glass-blur: blur(26px) saturate(185%)");
		expect(css).toContain("--digit-shadow: 0 3px 34px rgba(0, 0, 0, 0.24)");
		expect(rule('.oq-clock[data-theme="cyber"]')).toContain(
			"rgba(0, 229, 255, 0.32)",
		);
		expect(rule('.oq-clock[data-theme="cyber"]')).toContain(
			"rgba(255, 45, 180, 0.22)",
		);
		expect(rule('.oq-clock[data-theme="anime"]')).toContain(
			"rgba(140, 210, 255, 0.34)",
		);
		expect(rule('.oq-clock[data-theme="tactical"]')).toContain(
			"rgba(178, 255, 190, 0.25)",
		);
		expect(rule('.oq-clock[data-theme="aurora"]')).toContain(
			"rgba(190, 140, 255, 0.3)",
		);
		expect(rule(".oq-clock-scrim")).toContain("transparent 20%");
		expect(rule(".oq-clock-scrim")).toContain("transparent 18%");
		expect(rule(".oq-clock-scrim")).toContain("transparent 72%");
	});
});

describe("built-in art (WIDGETS-031)", () => {
	it("draws a deterministic 1920×480 scene for every theme", () => {
		for (const id of THEME_IDS) {
			const svg = themeArtSvg(id);
			expect(
				svg.startsWith(
					'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 480"',
				),
			).toBe(true);
			expect(svg.endsWith("</svg>")).toBe(true);
			expect(themeArtSvg(id)).toBe(svg);
			expect(svg).not.toContain("NaN");
			expect(svg.length).toBeLessThan(400_000);
		}
		expect(new Set(THEME_IDS.map(themeArtSvg)).size).toBe(5);
	});
});

describe("host helpers", () => {
	const snapshot: ClockSnapshot = {
		revision: 3,
		keyCode: "1,1",
		mode: "theme",
		themeId: "aurora",
		showSeconds: false,
		media: {
			aurora: {
				kind: "video",
				name: "a.webm",
				url: "oq-clock-media://theme/aurora?r=3",
				available: true,
			},
			cyber: {
				kind: "image",
				name: "c.png",
				url: "oq-clock-media://theme/cyber?r=3",
				available: false,
			},
		},
		recovered: false,
	};

	it("passes only available custom media to the tile", () => {
		expect(mediaOf(snapshot)).toEqual({
			aurora: { kind: "video", url: "oq-clock-media://theme/aurora?r=3" },
		});
		expect(themeOf(snapshot)).toBe("aurora");
		expect(themeOf({ ...snapshot, mode: "none" })).toBe("none");
	});

	it("maps bridge replies onto theme results", () => {
		expect(themeResultOf({ _tag: "success", snapshot })).toEqual({ ok: true });
		expect(
			themeResultOf({
				_tag: "failure",
				code: "QUAKE.CLOCK.PERSISTENCE_FAILED",
				message: "m",
				reason: "write-failed",
			}),
		).toEqual({ ok: false, reason: "write-failed" });
		expect(themeResultOf("garbage")).toEqual({
			ok: false,
			reason: "bad-config",
		});
	});

	it("never rewinds to an older revision", () => {
		expect(newest(snapshot, { ...snapshot, revision: 2 })).toBe(snapshot);
		const next = { ...snapshot, revision: 4 };
		expect(newest(snapshot, next)).toBe(next);
	});
});
