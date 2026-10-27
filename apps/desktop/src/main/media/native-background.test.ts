import { expect, it, vi } from "vitest";
import { applyWallpaperBackground } from "./native-background";

it("MAIN-051 SCREEN-007 reapplies serial background after reconnect without moving the panel", () => {
	const bounds = { x: 2810, y: 30, width: 1920, height: 480 };
	const window = {
		isDestroyed: () => false,
		getBounds: () => bounds,
		setBackgroundColor: vi.fn(),
		setBounds: vi.fn(),
		isAlwaysOnTop: () => true,
		setAlwaysOnTop: vi.fn(),
	};
	for (const transparent of [true, false, true, false])
		applyWallpaperBackground(window, transparent);
	expect(window.setBackgroundColor.mock.calls).toEqual([
		["#00000000"],
		["#000000"],
		["#00000000"],
		["#000000"],
	]);
	expect(window.setBounds.mock.calls).toEqual([
		[bounds],
		[bounds],
		[bounds],
		[bounds],
	]);
	expect(window.setAlwaysOnTop).toHaveBeenCalledTimes(4);
});
