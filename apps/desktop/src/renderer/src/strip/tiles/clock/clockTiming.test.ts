// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch, mount, required } from "../../../test/mount";
import {
	BackgroundLoader,
	type EffectiveBackground,
	initialBackground,
	MEDIA_LOAD_TIMEOUT_MS,
} from "./backgroundLoader";
import { ClockBackground } from "./ClockBackground";
import { startClockTicker } from "./clockHooks";
import { type ProbeTarget, probeVideoDuration } from "./probeVideo";

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("mounted background visibility (WIDGETS-035)", () => {
	const request = {
		kind: "theme",
		themeId: "aurora",
		media: { kind: "video", url: "oq-clock-media://theme/aurora?r=3" },
	} as const;

	it.each([false, true])(
		"pauses hidden video including hidden mount=%s and removes the listener",
		async (initialHidden) => {
			let hidden = initialHidden;
			vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
			const pause = vi
				.spyOn(HTMLMediaElement.prototype, "pause")
				.mockImplementation(() => {});
			const play = vi
				.spyOn(HTMLMediaElement.prototype, "play")
				.mockResolvedValue();
			vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(
				true,
			);
			const view = await mount(createElement(ClockBackground, { request }));
			try {
				const video = required(view.container, "video", HTMLVideoElement);
				expect(video.muted).toBe(true);
				expect(video.loop).toBe(true);
				if (initialHidden) expect(pause).toHaveBeenCalled();
				hidden = true;
				await dispatch(document, new Event("visibilitychange"));
				expect(pause).toHaveBeenCalled();
				expect(play).not.toHaveBeenCalled();
				hidden = false;
				await dispatch(document, new Event("visibilitychange"));
				expect(play).toHaveBeenCalledOnce();
				await dispatch(video, new Event("playing"));
				await act(async () => vi.advanceTimersByTime(5000));
				expect(view.container.querySelector("video")).toBe(video);
			} finally {
				await view.unmount();
			}
			pause.mockClear();
			play.mockClear();
			await dispatch(document, new Event("visibilitychange"));
			expect(pause).not.toHaveBeenCalled();
			expect(play).not.toHaveBeenCalled();
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it("applies hidden state to replacement media and falls back on its error", async () => {
		vi.spyOn(document, "hidden", "get").mockReturnValue(true);
		const pause = vi
			.spyOn(HTMLMediaElement.prototype, "pause")
			.mockImplementation(() => {});
		const view = await mount(
			createElement(ClockBackground, {
				request: { kind: "theme", themeId: "season" },
			}),
		);
		try {
			await view.render(createElement(ClockBackground, { request }));
			expect(pause).toHaveBeenCalled();
			await dispatch(
				required(view.container, "video", HTMLVideoElement),
				new Event("error"),
			);
			expect(
				required(view.container, "img", HTMLImageElement).dataset.theme,
			).toBe("aurora");
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			await view.unmount();
		}
	});
});

describe("custom background fallback (WIDGETS-035)", () => {
	const video = {
		kind: "theme",
		themeId: "aurora",
		media: { kind: "video", url: "oq-clock-media://theme/aurora?r=3" },
	} as const;

	it("falls back to that theme's built-in art after 5 s without playing", () => {
		const states: EffectiveBackground[] = [];
		const loader = new BackgroundLoader((state) => states.push(state));
		loader.apply(video);
		expect(loader.current).toMatchObject({ kind: "video", themeId: "aurora" });
		vi.advanceTimersByTime(MEDIA_LOAD_TIMEOUT_MS - 1);
		expect(loader.current.kind).toBe("video");
		vi.advanceTimersByTime(1);
		expect(loader.current).toMatchObject({
			kind: "builtin",
			themeId: "aurora",
		});
	});

	it("keeps custom media that starts in time", () => {
		const loader = new BackgroundLoader(() => {});
		loader.apply(video);
		loader.ready(loader.current.generation);
		vi.advanceTimersByTime(10_000);
		expect(loader.current.kind).toBe("video");
	});

	it("falls back at once on a media error", () => {
		const loader = new BackgroundLoader(() => {});
		loader.apply({
			...video,
			media: { kind: "image", url: "oq-clock-media://theme/aurora?r=4" },
		});
		loader.failed(loader.current.generation);
		expect(loader.current).toMatchObject({
			kind: "builtin",
			themeId: "aurora",
		});
		expect(vi.getTimerCount()).toBe(0);
	});

	it("ignores events from replaced media", () => {
		const loader = new BackgroundLoader(() => {});
		loader.apply(video);
		const stale = loader.current.generation;
		loader.apply({
			kind: "theme",
			themeId: "cyber",
			media: { kind: "image", url: "oq-clock-media://theme/cyber?r=5" },
		});
		loader.failed(stale);
		expect(loader.current).toMatchObject({ kind: "image", themeId: "cyber" });
		loader.ready(stale);
		vi.advanceTimersByTime(MEDIA_LOAD_TIMEOUT_MS);
		expect(loader.current).toMatchObject({ kind: "builtin", themeId: "cyber" });
	});

	it("draws built-in art and None without timers", () => {
		const loader = new BackgroundLoader(() => {});
		loader.apply({ kind: "theme", themeId: "season" });
		expect(loader.current).toMatchObject({
			kind: "builtin",
			themeId: "season",
		});
		loader.apply({ kind: "none" });
		expect(loader.current.kind).toBe("none");
		expect(vi.getTimerCount()).toBe(0);
		expect(initialBackground(video)).toMatchObject({
			kind: "video",
			generation: 0,
		});
	});

	it("releases its timer on dispose", () => {
		const loader = new BackgroundLoader(() => {});
		loader.apply(video);
		loader.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("wall-clock ticker (WIDGETS-029)", () => {
	it("ticks on minute boundaries, re-reading the time each time", () => {
		vi.setSystemTime(new Date(2025, 8, 4, 10, 7, 42, 300));
		const ticks: string[] = [];
		const stop = startClockTicker({
			seconds: false,
			onTick: (now) => ticks.push(now.toTimeString().slice(0, 8)),
		});
		vi.advanceTimersByTime(17_699);
		expect(ticks).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(ticks).toEqual(["10:08:00"]);
		vi.advanceTimersByTime(60_000);
		expect(ticks).toEqual(["10:08:00", "10:09:00"]);
		stop();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("ticks every second while seconds are shown", () => {
		vi.setSystemTime(new Date(2025, 8, 4, 10, 7, 42, 600));
		const ticks: number[] = [];
		const stop = startClockTicker({
			seconds: true,
			onTick: (now) => ticks.push(now.getSeconds()),
		});
		vi.advanceTimersByTime(2_399);
		expect(ticks).toEqual([43, 44]);
		stop();
	});

	it("resynchronizes when the window becomes visible after sleep", () => {
		vi.setSystemTime(new Date(2025, 8, 4, 23, 59, 30));
		const visibility = Object.assign(new EventTarget(), { hidden: false });
		const ticks: Date[] = [];
		const stop = startClockTicker({
			seconds: false,
			onTick: (now) => ticks.push(now),
			visibility,
		});
		// The host sleeps past midnight: wall time jumps, no timers fire.
		vi.setSystemTime(new Date(2025, 8, 5, 7, 15, 10));
		visibility.dispatchEvent(new Event("visibilitychange"));
		expect(ticks).toHaveLength(1);
		expect(ticks[0]?.getDate()).toBe(5);
		expect(ticks[0]?.getHours()).toBe(7);
		expect(vi.getTimerCount()).toBe(1);
		stop();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("video duration probe (WIDGETS-059)", () => {
	class FakeVideo extends EventTarget implements ProbeTarget {
		preload = "";
		muted = false;
		src = "";
		currentTime = 0;
		duration = Number.NaN;
		loads = 0;
		removeAttribute(): void {
			this.src = "";
		}
		load(): void {
			this.loads++;
		}
	}
	const fake = (video: FakeVideo) => () => video;

	it("reads the duration in milliseconds and releases the element", async () => {
		const video = new FakeVideo();
		const pending = probeVideoDuration(
			"oq-clock-media://candidate/ab",
			fake(video),
		);
		expect(video.src).toBe("oq-clock-media://candidate/ab");
		video.duration = 2.5;
		video.dispatchEvent(new Event("loadedmetadata"));
		await expect(pending).resolves.toBe(2500);
		expect(video.src).toBe("");
		expect(video.loads).toBe(1);
	});

	it("seeks to the end of streams without a duration", async () => {
		const video = new FakeVideo();
		const pending = probeVideoDuration("u", fake(video));
		video.duration = Number.POSITIVE_INFINITY;
		video.dispatchEvent(new Event("loadedmetadata"));
		expect(video.currentTime).toBe(Number.MAX_SAFE_INTEGER);
		video.duration = 3.04;
		video.dispatchEvent(new Event("durationchange"));
		await expect(pending).resolves.toBeCloseTo(3040);
	});

	it("gives up after 6 s or on error", async () => {
		const slow = new FakeVideo();
		const timedOut = probeVideoDuration("u", fake(slow));
		vi.advanceTimersByTime(6000);
		await expect(timedOut).resolves.toBeNull();
		const broken = new FakeVideo();
		const failed = probeVideoDuration("u", fake(broken));
		broken.dispatchEvent(new Event("error"));
		await expect(failed).resolves.toBeNull();
	});
});
