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
	it("renders a 24h typographic readout with no glass cards or side column", () => {
		const html = render();
		expect(html).not.toContain("oq-flip");
		expect(html).toContain(
			'<span class="oq-clock-hm" aria-hidden="true"><span>10</span><span class="oq-clock-colon">:</span><span>07</span></span>',
		);
		expect(html).toContain('data-time="10:07"');
		expect(html).not.toContain("oq-clock-aside");
		expect(html).toContain('<div class="oq-clock-cards" data-count="0"></div>');
		expect(html).toContain('class="oq-clock-week">THU<');
		expect(html).toContain('class="oq-clock-date">SEP 4<');
		expect(html).toContain('style="transform:scale(1, 1)"');
	});

	it("adds AM/PM in 12h and seconds only when enabled", () => {
		const twelve = render({ hourFormat: "12h" });
		expect(twelve).toContain('<span class="oq-clock-meridiem">AM</span>');
		expect(twelve).not.toContain("oq-clock-seconds");
		const seconds = render({ hourFormat: "12h", showSeconds: true });
		expect(seconds).toContain('<span class="oq-clock-seconds">42</span>');
	});

	it("scales the 1920×480 stage to the host without reflowing", () => {
		const html = render({ widthPx: 960, heightPx: 240 });
		expect(html).toContain("width:960px;height:240px");
		expect(html).toContain("transform:scale(0.5, 0.5)");
		expect(render({ widthPx: 1280, heightPx: 400 })).toContain(
			"transform:scale(0.6666666666666666, 0.8333333333333334)",
		);
	});

	it.each([200, 400, 800, 960, 1920])(
		"keeps the full-strip composition in a %ipx scaled preview",
		(width) => {
			const html = render({ widthPx: width, heightPx: width / 4 });
			expect(html).toContain('data-compact="false"');
			expect(html).toContain(
				`transform:scale(${width / 1920}, ${width / 1920})`,
			);
		},
	);
	it("uses compact layout only when the owning tile requests it", () => {
		const html = render({ widthPx: 456, heightPx: 456, layout: "compact" });
		expect(html).toContain('data-compact="true"');
		expect(html).not.toContain("transform:scale");
	});

	it("draws the theme's built-in art and name", () => {
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

	it("keeps the strip touch contract on the theme buttons", () => {
		const html = render();
		expect(html).toContain('data-quake-sub-touch="clock-theme-prev"');
		expect(html).toContain('data-quake-sub-touch="clock-theme-next"');
		expect(count(html, 'data-support-quake-move="false"')).toBe(2);
		expect(html).toContain('aria-label="Previous theme"');
		expect(html).toContain('aria-label="Next theme"');
	});

	it("exposes one complete accessible time and hides the visual parts", () => {
		for (const [props, label] of [
			[{}, "10:07"],
			[{ hourFormat: "12h" }, "10:07 AM"],
			[{ hourFormat: "12h", showSeconds: true }, "10:07:42 AM"],
			[{ hourFormat: "12h", now: new Date(2025, 8, 4, 22, 7, 42) }, "10:07 PM"],
		] satisfies ReadonlyArray<readonly [Partial<ClockTileProps>, string]>) {
			const html = render(props);
			expect(count(html, 'role="img"')).toBe(1);
			expect(html).toContain(`aria-label="${label}"`);
			expect(html).toContain('class="oq-clock-hm" aria-hidden="true"');
		}
	});

	it("places supplied cards in order and nothing else", () => {
		const html = render({
			weather: createElement("i", null, "w"),
			nowPlaying: createElement("i", null, "n"),
		});
		expect(html).toContain(
			'<div class="oq-clock-cards" data-count="2"><div class="oq-clock-card-slot" data-card="weather"><i>w</i></div><div class="oq-clock-card-slot" data-card="now-playing"><i>n</i></div></div>',
		);
	});

	it("marks reduced motion on the root", () => {
		expect(render({ reducedMotion: true })).toContain('data-motion="reduce"');
	});
});

describe("device design tokens in clock.css (independent-device-design)", () => {
	const css = readFileSync(new URL("./clock.css", import.meta.url), "utf8");
	const rule = (selector: string): string => {
		// The rule that starts with exactly this selector, not a selector list.
		const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const start = css.search(new RegExp(`(?<!,)\\n${escaped} \\{`));
		expect(start, selector).toBeGreaterThanOrEqual(0);
		return css.slice(start, css.indexOf("}", start));
	};

	it("draws no glass, blur, glow or flip animation", () => {
		expect(css).not.toMatch(
			/backdrop-filter|blur\(|rotateX|@keyframes|--glass/,
		);
		expect(rule(".oq-clock-hm")).toMatch(
			/font-size: 232px;\s+font-weight: 300;/,
		);
	});

	it("keeps one even scrim over theme art and an opaque information column", () => {
		expect(rule(".oq-clock-scrim")).toContain(
			"background: rgba(11, 12, 13, 0.62)",
		);
		expect(rule(".oq-clock-cards")).toContain(
			"background: var(--strip-surface)",
		);
		expect(rule('.oq-clock-cards[data-count="0"]')).toContain("display: none");
	});

	it("keeps 64 px theme switcher targets", () => {
		expect(rule(".oq-clock-nav-btn")).toMatch(/width: 64px;\s+height: 64px;/);
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
