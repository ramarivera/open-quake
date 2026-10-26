import { describe, expect, it } from "vitest";
import {
	findPanelDisplay,
	PANEL_SIZE,
	panelBounds,
	panelRotation,
	physicalLayout,
} from "./display";
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

it("MAIN-054 projects mixed DPI adjacency and negative origins without scaling DIP window positions", () => {
	const left = makeDisplay({
		id: 4,
		bounds: { x: -960, y: -100, width: 960, height: 600 },
		scaleFactor: 2,
	});
	const center = makeDisplay({
		id: 1,
		bounds: { x: 0, y: 0, width: 1280, height: 720 },
		scaleFactor: 2,
	});
	const right = makeDisplay({
		id: 2,
		label: "DK-QUAKE",
		bounds: { x: 1280, y: 0, width: 1920, height: 480 },
	});
	const layout = physicalLayout([center, right, left]);
	expect(
		layout.map((d) => [d.id, d.x, d.y, d.width, d.height, d.order]),
	).toEqual([
		[4, -960, -100, 1920, 1200, 0],
		[1, 0, 0, 2560, 1440, 1],
		[2, 2560, 0, 1920, 480, 2],
	]);
	expect(right.bounds.x).toBe(1280);
});

it("MAIN-052 SCREEN-006 keeps one logical canvas through load, rebind, mixed DPI and portrait placement", () => {
	const logical = { width: 1920, height: 480 };
	for (const scaleFactor of [1, 1.25, 1.5, 2])
		for (const rotated of [false, true]) {
			const width = (rotated ? 480 : 1920) / scaleFactor,
				height = (rotated ? 1920 : 480) / scaleFactor;
			const display = makeDisplay({
				id: 30,
				label: "DK-QUAKE",
				scaleFactor,
				size: { width, height },
				bounds: { x: -2000, y: 50, width, height },
			});
			const rebound = findPanelDisplay([makeDisplay(), display]);
			expect(rebound).toBe(display);
			expect(panelBounds(display, true)).toEqual(display.bounds);
			expect(panelRotation(display, true)).toBe(rotated ? 90 : 0);
			expect(PANEL_SIZE).toEqual(logical);
		}
});
