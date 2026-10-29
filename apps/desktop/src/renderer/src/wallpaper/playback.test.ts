// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultClockTile, defaultWallpaper } from "../../../shared/display";
import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import { mount } from "../../test/dom";
import { WallpaperCanvas } from "./WallpaperCanvas";

const snapshot: WallpaperSnapshot = {
	saved: {
		version: 1,
		serial: "A",
		revision: 0,
		clock: defaultClockTile,
		settings: {
			...defaultWallpaper,
			enableSound: true,
			displayMediaList: ["a", "b"].map((id) => ({
				name: id,
				type: "video",
				format: "video/webm",
				filePath: `media:${id.repeat(64)}`,
				duration: 60000,
			})),
		},
	},
	asset: {
		_tag: "ready",
		dataUrl: "data:video/webm;base64,YQ==",
		width: 320,
		height: 80,
	},
	clock: { epochMillis: 0, hour: 0, minute: 0, second: 0 },
	recovered: false,
	normalizedFileUrl: false,
	deviceDelivery: "unverified",
	activeIndex: 0,
	playbackId: 1,
	playbackStartedAt: 0,
};
afterEach(() => {
	window.localStorage.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it.each(["contour", "horizon", "plotter"])(
	"keeps video readiness and playlist progression under %s, muted until Original media returns",
	async (style) => {
		window.localStorage.setItem("open-quake.ambient.A", style);
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
		vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
		vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
		const mounted = await mount(
			createElement(WallpaperCanvas, { snapshot, sound: true }),
		);
		try {
			const first = mounted.host.querySelector("video");
			expect(first).not.toBeNull();
			expect(first?.muted).toBe(true);
			const next = {
				...snapshot,
				activeIndex: 1,
				playbackId: 2,
				asset: { ...snapshot.asset, dataUrl: "data:video/webm;base64,Yg==" },
			};
			await mounted.render(
				createElement(WallpaperCanvas, { snapshot: next, sound: true }),
			);
			const second = mounted.host.querySelector<HTMLVideoElement>(
				'.wallpaper-layer[data-state="preload"] video',
			);
			if (!second)
				throw new Error("The next video must be mounted for readiness");
			await act(async () => second.dispatchEvent(new Event("canplaythrough")));
			expect(
				second.closest(".wallpaper-layer")?.getAttribute("data-state"),
			).toBe("active");
			expect(second.muted).toBe(true);
			await act(async () => {
				window.localStorage.setItem("open-quake.ambient.A", "media");
				window.dispatchEvent(
					new StorageEvent("storage", { key: "open-quake.ambient.A" }),
				);
			});
			expect(
				mounted.host.querySelector(
					'.wallpaper-layer[data-state="active"] video',
				),
			).toBe(second);
			expect(second.muted).toBe(false);
			expect(mounted.host.querySelector(".ambient-art")).toBeNull();
		} finally {
			await mounted.close();
		}
	},
);
it("WIDGETS-130 seeks late mounts, waits for media readiness and retains unchanged-list video elements", async () => {
	vi.spyOn(Date, "now").mockReturnValue(50000);
	vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(60);
	const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
	const pause = vi
		.spyOn(HTMLMediaElement.prototype, "pause")
		.mockImplementation(() => {});
	const load = vi
		.spyOn(HTMLMediaElement.prototype, "load")
		.mockImplementation(() => {});
	const mounted = await mount(createElement(WallpaperCanvas, { snapshot }));
	const video = mounted.host.querySelector("video");
	if (!video) throw new Error("Missing video");
	expect(play).not.toHaveBeenCalled();
	await act(async () => video.dispatchEvent(new Event("canplaythrough")));
	expect(video.currentTime).toBe(50);
	expect(play).toHaveBeenCalled();
	video.currentTime = 51;
	await act(async () => video.dispatchEvent(new Event("canplaythrough")));
	expect(video.currentTime).toBe(51);
	expect(play).toHaveBeenCalledTimes(1);
	await mounted.render(
		createElement(WallpaperCanvas, {
			snapshot: { ...snapshot, saved: { ...snapshot.saved, revision: 1 } },
		}),
	);
	expect(mounted.host.querySelector("video")).toBe(video);
	await mounted.close();
	expect(pause).toHaveBeenCalled();
	expect(load).toHaveBeenCalled();
	expect(video.hasAttribute("src")).toBe(false);
});
it("SCREEN-007 WIDGETS-131 unmounts media and neutral fill when transparency changes and releases audio", async () => {
	const audio = vi.fn<
		NonNullable<NonNullable<Window["quakeWallpaper"]>["audio"]>
	>(async () => true);
	window.quakeWallpaper = {
		request: async () => undefined,
		audio,
		onSnapshot: () => () => {},
		onClock: () => () => {},
	};
	vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
	vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
	const mounted = await mount(
		createElement(WallpaperCanvas, { snapshot, sound: true }),
	);
	expect(
		mounted.host.querySelectorAll("video:not([muted])").length,
	).toBeLessThanOrEqual(1);
	await mounted.render(
		createElement(WallpaperCanvas, {
			snapshot: {
				...snapshot,
				saved: {
					...snapshot.saved,
					settings: { ...snapshot.saved.settings, isTransparent: true },
				},
			},
			sound: true,
		}),
	);
	expect(mounted.host.querySelector("video, image, rect")).toBeNull();
	expect(audio.mock.calls.some(([command]) => command.active === false)).toBe(
		true,
	);
	await mounted.close();
	delete window.quakeWallpaper;
});

it("SCREEN-105 enables native looping on the retained sole-playable video", async () => {
	vi.spyOn(Date, "now").mockReturnValue(7000);
	vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(5);
	vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
	const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
	vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
	vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
	const mounted = await mount(createElement(WallpaperCanvas, { snapshot }));
	try {
		const video = mounted.host.querySelector("video");
		expect(video?.loop).toBe(false);
		const starts = play.mock.calls.length;
		await mounted.render(
			createElement(WallpaperCanvas, {
				snapshot: { ...snapshot, ...{ loop: true } },
			}),
		);
		expect(mounted.host.querySelector("video")).toBe(video);
		expect(video?.loop).toBe(true);
		expect(video?.currentTime).toBe(2);
		expect(play).toHaveBeenCalledTimes(starts + 1);
	} finally {
		await mounted.close();
	}
});
