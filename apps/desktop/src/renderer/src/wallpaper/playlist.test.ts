import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { DisplayMedia } from "../../../shared/display";
import { defaultClockTile, defaultWallpaper } from "../../../shared/display";
import { WallpaperCanvas } from "./WallpaperCanvas";
import { WallpaperPlaylist } from "./WallpaperPlaylist";

it("renders saved order with drag targets and accessible boundary-aware move controls", () => {
	const items: DisplayMedia[] = ["first", "second", "third"].map(
		(name, index) => ({
			name,
			type: "image",
			format: "image/png",
			filePath: `media:${String(index).repeat(64)}`,
			duration: 5000,
		}),
	);
	const html = renderToStaticMarkup(
		createElement(WallpaperPlaylist, {
			items,
			disabled: false,
			move: () => undefined,
			remove: () => undefined,
		}),
	);
	expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
	expect(html.indexOf("second")).toBeLessThan(html.indexOf("third"));
	expect(html.match(/draggable="true"/g)).toHaveLength(3);
	expect(html).toContain('aria-label="Move first up" disabled=""');
	expect(html).toContain('aria-label="Move third down" disabled=""');
	const busy = renderToStaticMarkup(
		createElement(WallpaperPlaylist, {
			items,
			disabled: true,
			move: () => undefined,
			remove: () => undefined,
		}),
	);
	expect(busy.match(/disabled=""/g)).toHaveLength(9);
	expect(busy).not.toContain('draggable="true"');
});

it("renders singleton video looping, preview muted, and only a sound-enabled panel eligible to unmute", () => {
	const snapshot = {
		saved: {
			version: 1 as const,
			serial: "A",
			revision: 1,
			clock: defaultClockTile,
			settings: {
				...defaultWallpaper,
				enableSound: true,
				displayMediaList: [
					{
						name: "video",
						filePath: `media:${"a".repeat(64)}`,
						type: "video" as const,
						format: "video/mp4" as const,
						duration: 3000,
					},
				],
			},
		},
		asset: {
			_tag: "ready" as const,
			dataUrl: "data:video/mp4;base64,YQ==",
			width: 1920,
			height: 480,
		},
		recovered: false,
		normalizedFileUrl: false,
		deviceDelivery: "unverified" as const,
		clock: { epochMillis: 0, hour: 0, minute: 0, second: 0 },
	};
	const preview = renderToStaticMarkup(
		createElement(WallpaperCanvas, { snapshot }),
	);
	expect(preview).toContain('muted=""');
	expect(preview).toContain('loop=""');
	const panel = renderToStaticMarkup(
		createElement(WallpaperCanvas, { snapshot, sound: true }),
	);
	expect(panel).not.toContain('muted=""');
	const off = renderToStaticMarkup(
		createElement(WallpaperCanvas, {
			snapshot: {
				...snapshot,
				saved: {
					...snapshot.saved,
					settings: { ...snapshot.saved.settings, enableSound: false },
				},
			},
			sound: true,
		}),
	);
	expect(off).toContain('muted=""');
});
