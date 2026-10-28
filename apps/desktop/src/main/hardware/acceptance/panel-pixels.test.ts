import { expect, it } from "vitest";
import { comparePanelPixels, type PanelBitmap } from "./panel-pixels.js";

const bitmap = (
	pixel: (index: number) => readonly [number, number, number, number],
): PanelBitmap => {
	const width = 16;
	const height = 4;
	const data = new Uint8Array(width * height * 4);
	for (let index = 0; index < width * height; index++)
		data.set(pixel(index), index * 4);
	return { width, height, data };
};
const panel = bitmap((i) => [i * 3, 40, 200 - i, 255]);
const desktop = bitmap(() => [230, 180, 60, 255]);

it("accepts a display that shows the rendered panel instead of the desktop", () => {
	const evidence = comparePanelPixels(
		bitmap((i) => [i * 3 + 2, 41, 199 - i, 255]),
		panel,
		desktop,
	);
	expect(evidence.passed).toBe(true);
	expect(evidence.coverage).toBe(1);
});

it("rejects the unchanged desktop, a blank frame and a transparent panel", () => {
	expect(comparePanelPixels(desktop, panel, desktop).passed).toBe(false);
	const black = bitmap(() => [0, 0, 0, 255]);
	expect(comparePanelPixels(black, black, desktop).passed).toBe(false);
	// Alternating colors of equal mean brightness are still a picture.
	const stripes = bitmap((i) => (i % 2 ? [200, 0, 0, 255] : [0, 200, 0, 255]));
	expect(comparePanelPixels(stripes, stripes, desktop).passed).toBe(true);
	const transparent = bitmap((i) => [i * 3, 40, 200 - i, 0]);
	expect(comparePanelPixels(panel, transparent, desktop).passed).toBe(false);
});

it("refuses bitmaps of different sizes", () => {
	expect(() =>
		comparePanelPixels(panel, { ...panel, width: 8 }, desktop),
	).toThrow("share one size");
});
