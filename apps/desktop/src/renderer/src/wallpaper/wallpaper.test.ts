import { Schema } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	type ClockSnapshot,
	defaultClockTile,
	defaultWallpaper,
} from "../../../shared/display";
import {
	WallpaperCommand,
	WallpaperReply,
	type WallpaperSnapshot,
} from "../../../shared/wallpaper-contracts";
import { subscribeWallpaper } from "./useWallpaper";
import { WallpaperCanvas } from "./WallpaperCanvas";

const snapshot: WallpaperSnapshot = {
	saved: {
		version: 1,
		serial: "A",
		revision: 2,
		settings: defaultWallpaper,
		clock: defaultClockTile,
	},
	asset: {
		_tag: "ready",
		dataUrl: "data:image/png;base64,YQ==",
		width: 480,
		height: 480,
	},
	clock: { epochMillis: 0, hour: 0, minute: 0, second: 0 },
	recovered: false,
	normalizedFileUrl: false,
	deviceDelivery: "unverified",
};
const render = (value?: WallpaperSnapshot): string =>
	renderToStaticMarkup(createElement(WallpaperCanvas, { snapshot: value }));

describe("shared panel and preview consumer", () => {
	it("renders identical snapshots, native logical geometry and host clock in both windows", () => {
		const contain = {
			...snapshot,
			saved: {
				...snapshot.saved,
				settings: { ...defaultWallpaper, bgFillMode: "contain" as const },
			},
		};
		const panel = render(contain);
		const preview = render(structuredClone(contain));
		expect(preview).toBe(panel);
		expect(panel).toContain('viewBox="0 0 1920 480"');
		expect(panel).toContain('x="720" y="0" width="480" height="480"');
		expect(panel).toContain('data-time="00:00:00"');
		expect(panel).toContain('data-tile="dkDesktopClock">00:00</text>');
		expect(panel).toContain(">00</text>");
		const twelve = render({
			...snapshot,
			saved: {
				...snapshot.saved,
				clock: {
					...defaultClockTile,
					actions: [{ type: "hourFormat", value: "12h" }],
				},
			},
		});
		expect(twelve).toContain('data-time="12:00:00 AM"');
		expect(twelve).toContain(">12:00</text>");
		expect(twelve).toContain(">AM</text>");
		expect(panel).not.toContain("hardware-applied");
		expect(render(snapshot)).toContain(
			'x="0" y="-720" width="1920" height="1920"',
		);
	});
	it("uses neutral theme styling and no decorative animation in empty and unreadable states", () => {
		for (const value of [
			undefined,
			{ ...snapshot, asset: { _tag: "empty" as const } },
			{ ...snapshot, asset: { _tag: "unreadable" as const } },
		]) {
			const markup = render(value);
			expect(markup).toContain('class="wallpaper-neutral"');
			expect(markup).not.toContain("<image");
			expect(markup).not.toContain("animate");
		}
	});
	it("accepts decoded notifications, rejects malformed data, and removes both listeners", () => {
		let acceptSnapshot: (value: unknown) => void = () => undefined;
		let acceptClock: (value: unknown) => void = () => undefined;
		const offSnapshot = vi.fn();
		const offClock = vi.fn();
		const update = vi.fn();
		const tick = vi.fn();
		const unsubscribe = subscribeWallpaper(
			{
				request: async () => undefined,
				onSnapshot: (cb) => {
					acceptSnapshot = cb;
					return offSnapshot;
				},
				onClock: (cb) => {
					acceptClock = cb;
					return offClock;
				},
			},
			update,
			tick,
		);
		acceptSnapshot({ ...snapshot, deviceDelivery: "applied" });
		acceptSnapshot({
			...snapshot,
			asset: { ...snapshot.asset, dataUrl: "file:///private/image.png" },
		});
		acceptClock({ ...snapshot.clock, hour: 24 });
		expect(update).not.toHaveBeenCalled();
		expect(tick).not.toHaveBeenCalled();
		acceptSnapshot(snapshot);
		const next: ClockSnapshot = {
			...snapshot.clock,
			second: 1,
			epochMillis: 1000,
		};
		acceptClock(next);
		expect(update).toHaveBeenCalledWith(snapshot);
		expect(tick).toHaveBeenCalledWith(next);
		unsubscribe();
		expect(offSnapshot).toHaveBeenCalledOnce();
		expect(offClock).toHaveBeenCalledOnce();
	});
	it("rejects unknown commands and unsupported revisions at the decoded boundary", () => {
		expect(
			Schema.is(WallpaperCommand)({
				_tag: "load-path",
				path: "/private/image.png",
			}),
		).toBe(false);
		expect(
			Schema.is(WallpaperCommand)({
				_tag: "configure",
				serial: "A",
				revision: -1,
				fillMode: "cover",
				hourFormat: "24h",
			}),
		).toBe(false);
		expect(
			Schema.is(WallpaperReply)({
				_tag: "success",
				snapshot: { ...snapshot, saved: { ...snapshot.saved, version: 2 } },
			}),
		).toBe(false);
	});
});
