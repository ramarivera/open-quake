import { describe, expect, it } from "vitest";
import { cardRect, pickerLayout, pickerTarget, sameTarget } from "./geometry";

describe("recovered thumbnail picker geometry", () => {
	it("retains the source's column table, 4:1 ratio, and paged 300 by 75 cards", () => {
		for (const [count, columns] of [
			[1, 2],
			[2, 2],
			[3, 3],
			[6, 3],
			[8, 4],
			[9, 3],
			[12, 4],
			[15, 5],
			[16, 5],
		]) {
			const layout = pickerLayout(count ?? 1);
			expect(layout.columns).toBe(columns);
			expect(layout.width).toBe(layout.height * 4);
			expect(layout.nameSize).toBeGreaterThanOrEqual(26);
			for (let i = 0; i < Math.min(count ?? 1, 15); i++) {
				const rect = cardRect(count ?? 1, i);
				expect(rect.x).toBeGreaterThanOrEqual(16);
				expect(rect.x + rect.width).toBeLessThanOrEqual(1904);
				// Source rounds each 4:1 card height before centering the grid.
				expect(rect.y).toBeGreaterThanOrEqual(65);
				expect(rect.y + rect.height).toBeLessThanOrEqual(437);
			}
		}
		expect(pickerLayout(30)).toMatchObject({
			columns: 5,
			rows: 3,
			width: 300,
			height: 75,
		});
	});
	it("hits cards and only visible arrows, and rejects drags off a card", () => {
		const rect = cardRect(17, 0);
		expect(pickerTarget(17, 0, rect.x + 5, rect.y + 5)).toEqual({
			kind: "card",
			index: 0,
		});
		expect(pickerTarget(17, 0, 50, 240)).toEqual({ kind: "blank" });
		expect(pickerTarget(17, 0, 1800, 240)).toEqual({ kind: "page", delta: 1 });
		expect(pickerTarget(17, 1, 1800, 240)).toEqual({ kind: "blank" });
		expect(pickerTarget(17, 1, 50, 240)).toEqual({ kind: "page", delta: -1 });
		expect(
			sameTarget(
				pickerTarget(17, 0, rect.x + 5, rect.y + 5),
				pickerTarget(17, 0, 0, 0),
			),
		).toBe(false);
	});
});
