import { describe, expect, it } from "vitest";
import { findPanelDisplay, panelBounds, panelRotation } from "./display";
import { makeDisplay } from "./test/display";

const portrait = makeDisplay({
	id: 3,
	label: "DK-QUAKE",
	size: { width: 480, height: 1920 },
	bounds: { x: -480, y: 0, width: 480, height: 1920 },
	workArea: { x: -480, y: 25, width: 480, height: 1895 },
});

describe("findPanelDisplay", () => {
	it("prefers physical size over an unrelated labelled resolution mismatch", () => {
		const sizeMatch = makeDisplay({ size: { width: 1920, height: 480 } });
		const labelled = makeDisplay({ id: 2, label: "Display DK-QUAKE USB" });
		expect(findPanelDisplay([sizeMatch, labelled])).toBe(sizeMatch);
	});

	it("matches the display label case-insensitively", () => {
		const labelled = makeDisplay({ label: "dK-qUaKe" });
		expect(findPanelDisplay([makeDisplay(), labelled])).toBe(labelled);
	});

	it.each([
		{ width: 1920, height: 480 },
		{ width: 480, height: 1920 },
	])(
		"falls back to a $width x $height display when labels do not match",
		(size) => {
			const panel = makeDisplay({ label: "", size });
			expect(findPanelDisplay([makeDisplay(), panel])).toBe(panel);
		},
	);

	it("matches physical pixels and rejects the strict ten-pixel boundary", () => {
		expect(
			findPanelDisplay([
				makeDisplay({ size: { width: 960, height: 240 }, scaleFactor: 2 }),
			]),
		).toBeDefined();
		expect(
			findPanelDisplay([makeDisplay({ size: { width: 1911, height: 489 } })]),
		).toBeDefined();
		expect(
			findPanelDisplay([makeDisplay({ size: { width: 1910, height: 480 } })]),
		).toBeUndefined();
	});
	it("leaves multiple matching strips ambiguous", () => {
		expect(
			findPanelDisplay([
				portrait,
				makeDisplay({ size: { width: 1920, height: 480 } }),
			]),
		).toBeUndefined();
	});
	it("returns undefined when neither label nor both dimensions match", () => {
		expect(
			findPanelDisplay([
				makeDisplay({ size: { width: 1920, height: 1080 } }),
				makeDisplay({ size: { width: 2560, height: 480 } }),
				makeDisplay({ size: { width: 480, height: 1080 } }),
			]),
		).toBeUndefined();
		expect(findPanelDisplay([])).toBeUndefined();
	});
});

describe("panel geometry", () => {
	it("rotates the canvas on the strip's native portrait framebuffer only", () => {
		expect(panelRotation(portrait, true)).toBe(90);
		expect(
			panelRotation(makeDisplay({ size: { width: 1920, height: 480 } }), true),
		).toBe(0);
	});

	it("never rotates the landscape fallback window on a portrait monitor", () => {
		const portraitMonitor = makeDisplay({
			size: { width: 1080, height: 1920 },
		});
		expect(panelRotation(portraitMonitor, false)).toBe(0);
	});

	it("owns the whole strip, including the menu-bar area", () => {
		expect(panelBounds(portrait, true)).toEqual(portrait.bounds);
	});

	it("clamps the fallback window to the primary work area", () => {
		const small = makeDisplay({
			workArea: { x: 0, y: 25, width: 1600, height: 400 },
		});
		expect(panelBounds(small, false)).toEqual({
			x: 0,
			y: 25,
			width: 1600,
			height: 400,
		});
	});
});
