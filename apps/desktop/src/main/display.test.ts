import { describe, expect, it } from "vitest";
import { findPanelDisplay } from "./display";
import { makeDisplay } from "./test/display";

describe("findPanelDisplay", () => {
	it("prefers a label containing DK-QUAKE over an earlier size match", () => {
		const sizeMatch = makeDisplay({ size: { width: 1920, height: 480 } });
		const labelled = makeDisplay({ id: 2, label: "Display DK-QUAKE USB" });
		expect(findPanelDisplay([sizeMatch, labelled])).toBe(labelled);
	});

	it("matches the display label case-insensitively", () => {
		const labelled = makeDisplay({ label: "dK-qUaKe" });
		expect(findPanelDisplay([makeDisplay(), labelled])).toBe(labelled);
	});

	it("falls back to a 1920x480 display when labels do not match", () => {
		const panel = makeDisplay({
			label: "",
			size: { width: 1920, height: 480 },
		});
		expect(findPanelDisplay([makeDisplay(), panel])).toBe(panel);
	});

	it("returns undefined when neither label nor both dimensions match", () => {
		expect(
			findPanelDisplay([
				makeDisplay({ size: { width: 1920, height: 1080 } }),
				makeDisplay({ size: { width: 2560, height: 480 } }),
			]),
		).toBeUndefined();
		expect(findPanelDisplay([])).toBeUndefined();
	});
});
