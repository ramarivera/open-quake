// @vitest-environment happy-dom
import { Schema } from "effect";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clockProfile,
	stripFixtureEnvelope,
} from "../../../main/test/strip-fixtures";
import { ProfileEnvelope } from "../../../shared/profiles";
import type { MediaSnapshot } from "../../../shared/weather-media-contracts";
import { StripScreen } from "../strip/StripScreen";
import { dispatch, mount, nativeTouch, required } from "../test/mount";
import { ClockMusicCard, ClockWeatherCard } from "./ClockCards";

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

// Independent oracle from recovered shared/weatherIconGroups.js and WeatherIcon.vue.
const groups = [
	[
		"clear",
		[0, 1],
		"M24 3v5m0 32v5M3 24h5m32 0h5M9 9l4 4m22 22 4 4M9 39l4-4m22-22 4-4",
	],
	["partlyCloudy", [2], "M35 3v4m7 3 3-3M41 17h5"],
	["cloudy", [3], null],
	["fog", [45, 48], "M9 38h30M14 43h20"],
	["drizzle", [51, 53, 55, 56, 57], "m16 37-2 5m11-5-2 5m11-5-2 5"],
	["rain", [61, 63, 65, 66, 67, 80, 81, 82], "m16 37-2 5m11-5-2 5m11-5-2 5"],
	["snow", [71, 73, 75, 77, 85, 86], "M16 36v8m-4-4h8m10-4v8m-4-4h8"],
	["thunder", [95, 96, 99], "m27 28-7 10h7l-5 9"],
] as const;
const known = new Set<number>(groups.flatMap(([, codes]) => [...codes]));
const unknown = [
	null,
	-1,
	1000,
	Number.NaN,
	...Array.from({ length: 101 }, (_, i) => i).filter((i) => !known.has(i)),
];
const cases = [
	...groups.flatMap(([group, codes, path]) =>
		codes.map((code) => ({ group, code, path })),
	),
	...unknown.map((code) => ({ group: "default", code, path: null })),
];

describe("SCREEN-124 / WIDGETS-041: rendered WMO weather groups", () => {
	it.each(cases)(
		"code $code renders $group geometry",
		async ({ group, code, path }) => {
			const view = await mount(
				createElement(ClockWeatherCard, {
					city: "Berlin",
					unit: "celsius",
					state: {
						kind: "ready",
						temperature: 12,
						high: 18,
						low: 8,
						weatherCode: code,
						description: "Weather",
						stale: false,
					},
				}),
			);
			try {
				const svg = required(view.container, "svg", SVGElement);
				expect(svg.getAttribute("data-weather-icon")).toBe(group);
				expect(svg.getAttribute("stroke-width")).toBe("1.8");
				const paths = Array.from(svg.querySelectorAll("path"), (p) =>
					p.getAttribute("d"),
				);
				if (path) expect(paths).toContain(path);
				else
					expect(paths).toEqual([
						"M12 32a9 9 0 0 1-1-18 13 13 0 0 1 25-1 10 10 0 0 1 0 19H12",
					]);
				expect(svg.querySelector("circle") !== null).toBe(group === "clear");
			} finally {
				await view.unmount();
			}
		},
	);
});

const playing: MediaSnapshot = {
	revision: 1,
	error: null,
	session: {
		id: "song",
		appId: "fixture",
		appName: "Fixture",
		title: "Song",
		artist: "Artist",
		coverUrl: "data:image/png;base64,AA==",
		playing: true,
		durationMs: 10000,
		positionMs: 2000,
		canNext: true,
		canPrevious: true,
		canPlay: true,
		canPause: true,
	},
};

describe("WIDGETS-055: mounted music card", () => {
	it("falls back on cover error, resets for a new cover, and expires a rejected-control tip at 1.8 s", async () => {
		const control = vi.fn(async () => false);
		const view = await mount(
			createElement(ClockMusicCard, { snapshot: playing, control }),
		);
		try {
			await dispatch(
				required(view.container, "img", HTMLImageElement),
				new Event("error"),
			);
			expect(view.container.querySelector("img")).toBeNull();
			expect(view.container.querySelector(".oq-music-cover")?.textContent).toBe(
				"♪",
			);
			await dispatch(
				required(
					view.container,
					'[data-testid="clock-music-play"]',
					HTMLButtonElement,
				),
				new MouseEvent("click", { bubbles: true }),
			);
			expect(control.mock.calls).toEqual([["toggle"]]);
			expect(view.container.querySelector('[role="status"]')?.textContent).toBe(
				"Music unavailable",
			);
			await act(async () => vi.advanceTimersByTime(1799));
			expect(view.container.querySelector('[role="status"]')).not.toBeNull();
			await act(async () => vi.advanceTimersByTime(1));
			expect(view.container.querySelector('[role="status"]')).toBeNull();
			await view.render(
				createElement(ClockMusicCard, {
					snapshot: {
						...playing,
						session: playing.session && {
							...playing.session,
							coverUrl: "data:image/png;base64,AQ==",
						},
					},
					control,
				}),
			);
			expect(
				required(view.container, "img", HTMLImageElement).getAttribute("src"),
			).toBe("data:image/png;base64,AQ==");
		} finally {
			await view.unmount();
		}
		expect(vi.getTimerCount()).toBe(0);
	});

	it("reconciles capabilities, native cancellation, idle and unavailable without stale controls", async () => {
		const control = vi.fn(async () => true);
		const view = await mount(
			createElement(ClockMusicCard, { snapshot: playing, control }),
		);
		const button = () =>
			required(
				view.container,
				'[data-testid="clock-music-next"]',
				HTMLButtonElement,
			);
		try {
			await dispatch(button(), nativeTouch("start"));
			await dispatch(button(), nativeTouch("end", false));
			expect(control).not.toHaveBeenCalled();
			await view.render(
				createElement(ClockMusicCard, {
					snapshot: {
						...playing,
						session: playing.session && {
							...playing.session,
							canNext: false,
							canPause: false,
						},
					},
					control,
				}),
			);
			expect(button().disabled).toBe(true);
			expect(
				required(
					view.container,
					'[data-testid="clock-music-play"]',
					HTMLButtonElement,
				).disabled,
			).toBe(true);
			await dispatch(button(), nativeTouch("end"));
			expect(control).not.toHaveBeenCalled();
			for (const error of [null, "MEDIAREMOTE_UNAVAILABLE"] as const) {
				await view.render(
					createElement(ClockMusicCard, {
						snapshot: { revision: 3, session: null, error },
						control,
					}),
				);
				expect(
					view.container
						.querySelector(".oq-music-card")
						?.getAttribute("data-state"),
				).toBe(error ? "unavailable" : "idle");
				expect(
					Array.from(
						view.container.querySelectorAll("button"),
						(b) => b.disabled,
					),
				).toEqual([true, true, true]);
				await act(async () => vi.advanceTimersByTime(1800));
				expect(view.container.querySelector('[role="status"]') !== null).toBe(
					!!error,
				);
			}
		} finally {
			await view.unmount();
		}
	});

	it("passive StripScreen blocks programmatic pointer, keyboard and native transport input", async () => {
		const request = vi.fn(async () => {
			throw new Error("Passive preview requested a live bridge");
		});
		window.quakeWeatherMedia = { request, onSnapshot: () => () => {} };
		const encoded = stripFixtureEnvelope(clockProfile);
		const envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
			...encoded,
			profiles: encoded.profiles.map((profile) =>
				profile.id !== clockProfile.id
					? profile
					: {
							...profile,
							pages: profile.pages.map((page) => ({
								...page,
								keys: page.keys.map((key) => ({
									...key,
									config: {
										...key.config,
										actions: [
											...(key.config.actions ?? []),
											{ type: "clockStyle", value: { musicEnabled: true } },
										],
									},
								})),
							})),
						},
			),
		});
		const profiles = { _tag: "ready", envelope } as const;
		const view = await mount(
			createElement(StripScreen, {
				profiles,
				interactive: false,
				showEmptyGridDashedBorder: false,
			}),
		);
		try {
			const button = required(
				view.container,
				'[data-testid="clock-music-play"]',
				HTMLButtonElement,
			);
			for (const event of [
				new MouseEvent("click", { bubbles: true }),
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
				nativeTouch("end"),
			])
				await dispatch(button, event);
			expect(request).not.toHaveBeenCalled();
			expect(
				required(view.container, ".strip-screen", HTMLDivElement).inert,
			).toBe(true);
		} finally {
			await view.unmount();
			delete window.quakeWeatherMedia;
		}
	});
});
