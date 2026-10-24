import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BackgroundLoader,
	type EffectiveBackground,
	initialBackground,
	MEDIA_LOAD_TIMEOUT_MS,
} from "./backgroundLoader";
import { startClockTicker } from "./clockHooks";
import { FLIP_PHASE_MS, FlipSequencer, type FlipState } from "./flipSequencer";
import { type ProbeTarget, probeVideoDuration } from "./probeVideo";

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("minute flip (WIDGETS-027/028)", () => {
	it("runs two 380 ms phases: old upper falls, new upper drops, then rests", () => {
		const states: FlipState[] = [];
		const flip = new FlipSequencer(7, (state) => states.push(state));
		expect(FLIP_PHASE_MS).toBe(380);
		flip.set(8, false);
		expect(flip.snapshot).toEqual({ upper: 7, phase: "turn-on" });
		vi.advanceTimersByTime(379);
		expect(flip.snapshot.phase).toBe("turn-on");
		vi.advanceTimersByTime(1);
		expect(flip.snapshot).toEqual({ upper: 8, phase: "turn-down" });
		vi.advanceTimersByTime(379);
		expect(flip.snapshot.phase).toBe("turn-down");
		vi.advanceTimersByTime(1);
		expect(flip.snapshot).toEqual({ upper: 8, phase: "rest" });
		expect(states).toEqual([
			{ upper: 7, phase: "turn-on" },
			{ upper: 8, phase: "turn-down" },
			{ upper: 8, phase: "rest" },
		]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("restarts from the previously shown value when the digit changes mid-flip", () => {
		const flip = new FlipSequencer(1, () => {});
		flip.set(2, false);
		vi.advanceTimersByTime(500);
		flip.set(3, false);
		expect(flip.snapshot).toEqual({ upper: 2, phase: "turn-on" });
		vi.advanceTimersByTime(760);
		expect(flip.snapshot).toEqual({ upper: 3, phase: "rest" });
		expect(vi.getTimerCount()).toBe(0);
	});

	it("switches immediately under reduced motion", () => {
		const flip = new FlipSequencer(4, () => {});
		flip.set(5, true);
		expect(flip.snapshot).toEqual({ upper: 5, phase: "rest" });
		expect(vi.getTimerCount()).toBe(0);
	});

	it("ignores repeats and releases its timer on dispose", () => {
		const onChange = vi.fn();
		const flip = new FlipSequencer(4, onChange);
		flip.set(4, false);
		expect(onChange).not.toHaveBeenCalled();
		flip.set(5, false);
		flip.dispose();
		expect(vi.getTimerCount()).toBe(0);
		flip.set(6, false);
		expect(onChange).toHaveBeenCalledTimes(1);
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
