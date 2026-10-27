import { afterEach, expect, it, vi } from "vitest";
import { defaultClockTile, defaultWallpaper } from "../../../shared/display";
import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import { type WallpaperLayer, WallpaperLayers } from "./layer-player";

export const playerSnapshot: WallpaperSnapshot = {
	saved: {
		version: 1,
		serial: "A",
		revision: 0,
		clock: defaultClockTile,
		settings: {
			...defaultWallpaper,
			displayMediaList: ["a", "b"].map((id) => ({
				name: id,
				type: "video",
				format: "video/webm",
				filePath: `media:${id.repeat(64)}`,
				duration: 5000,
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
afterEach(() => vi.useRealTimers());
it("SCREEN-105 WIDGETS-130 preloads B, waits for canplaythrough, fades for 800ms and disposes", () => {
	vi.useFakeTimers();
	let layers: readonly WallpaperLayer[] = [];
	const player = new WallpaperLayers((next) => {
		layers = next;
	}, vi.fn());
	player.apply(playerSnapshot);
	const a = layers[0]?.id;
	player.apply({
		...playerSnapshot,
		preload: { index: 1, asset: playerSnapshot.asset },
	});
	expect(layers.map((l) => l.state)).toEqual(["active", "preload"]);
	const b = layers[1]?.id;
	if (!b) throw new Error("Missing B");
	const next = {
		...playerSnapshot,
		activeIndex: 1,
		playbackId: 2,
		playbackStartedAt: 4200,
	};
	player.apply(next);
	expect(layers[0]?.id).toBe(a);
	expect(layers.map((l) => l.state)).toEqual(["active", "preload"]);
	player.loaded(b);
	expect(layers.map((l) => l.state)).toEqual(["retired", "active"]);
	vi.advanceTimersByTime(799);
	expect(layers).toHaveLength(2);
	vi.advanceTimersByTime(1);
	expect(layers.map((l) => l.id)).toEqual([b]);
	player.apply({ ...next, saved: { ...next.saved, revision: 1 } });
	expect(layers[0]?.id).toBe(b);
	player.dispose();
	expect(vi.getTimerCount()).toBe(0);
});
it("WIDGETS-131 suppresses all layers for transparency, hide and teardown; resumes and remounts on resize", () => {
	let layers: readonly WallpaperLayer[] = [];
	const errors = vi.fn();
	const player = new WallpaperLayers((next) => {
		layers = next;
	}, errors);
	player.apply(playerSnapshot);
	const first = layers[0]?.id;
	player.visibility(true);
	expect(layers).toEqual([]);
	player.visibility(false);
	expect(layers[0]?.id).not.toBe(first);
	player.resize();
	expect(layers[0]?.id).not.toBe(first);
	player.apply({
		...playerSnapshot,
		saved: {
			...playerSnapshot.saved,
			settings: { ...playerSnapshot.saved.settings, isTransparent: true },
		},
	});
	expect(layers).toEqual([]);
	player.loaded(first ?? -1);
	expect(layers).toEqual([]);
	player.dispose();
	player.error(first ?? -1);
	expect(errors).not.toHaveBeenCalled();
});
it("SCREEN-105 skips failed media once active and suppresses decorative fades with reduced motion", () => {
	vi.useFakeTimers();
	let layers: readonly WallpaperLayer[] = [];
	const errors = vi.fn();
	const player = new WallpaperLayers(
		(next) => {
			layers = next;
		},
		errors,
		() => true,
	);
	player.apply(playerSnapshot);
	player.error(layers[0]?.id ?? -1);
	expect(errors).toHaveBeenCalledWith(playerSnapshot, 0);
	const next = { ...playerSnapshot, activeIndex: 1, playbackId: 2 };
	player.apply(next);
	const id = layers[1]?.id;
	player.loaded(id ?? -1);
	expect(layers).toHaveLength(1);
	expect(layers[0]?.state).toBe("active");
	expect(vi.getTimerCount()).toBe(0);
	player.dispose();
});

it("SCREEN-105 removes a failed active layer when the controller exhausts the playlist", () => {
	let layers: readonly WallpaperLayer[] = [];
	const player = new WallpaperLayers((next) => {
		layers = next;
	}, vi.fn());
	player.apply(playerSnapshot);
	player.error(layers[0]?.id ?? -1);
	player.apply({ ...playerSnapshot, asset: { _tag: "unreadable" } });
	expect(layers).toEqual([]);
	player.dispose();
});
