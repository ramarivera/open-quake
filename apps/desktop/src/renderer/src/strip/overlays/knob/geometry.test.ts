import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clientToLogical } from "../../touch-geometry";
import {
	cardRect,
	focusTargetRect,
	pickerLayout,
	pickerTarget,
	sameTarget,
	tileRect,
} from "./geometry";
import { KnobDial } from "./KnobDial";

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

it("inverts rotation 90 and viewport scaling before picker arrow/card hits", () => {
	const bounds = { x: 40, y: 60, width: 240, height: 960 };
	const logical = (x: number, y: number) =>
		clientToLogical({ x, y }, bounds, 90);
	expect(pickerTarget(17, 0, logical(160, 970).x, logical(160, 970).y)).toEqual(
		{ kind: "page", delta: 1 },
	);
	const card = cardRect(17, 0);
	const point = logical(
		40 + (480 - card.y - card.height / 2) / 2,
		60 + (card.x + card.width / 2) / 2,
	);
	expect(pickerTarget(17, 0, point.x, point.y)).toEqual({
		kind: "card",
		index: 0,
	});
});

describe("knob focus targets", () => {
	const hotkey = { keyCode: "1,1", slot: tileRect("1,1", [2, 1]) };
	it("gives no target to a key the strip layout hides under a wider tile", () => {
		const layout = { tiles: [hotkey] };
		expect(
			focusTargetRect({ keyCode: "1,2", size: [1, 1] }, layout),
		).toBeUndefined();
		expect(focusTargetRect({ keyCode: "1,1", size: [2, 1] }, layout)).toEqual(
			hotkey.slot,
		);
	});
	it("falls back to the anchor rectangle when there is no layout", () => {
		expect(
			focusTargetRect({ keyCode: "1,2", size: [1, 1] }, undefined),
		).toEqual(tileRect("1,2", [1, 1]));
	});
});

describe("KNOB-016: rendered focus indicator", () => {
	it.each([
		[220, 220, 0],
		[460, 220, 90],
		[1920, 480, -45],
	])(
		"fits %d × %d and ignores detent angle %d without covering tile content",
		(width, height, angle) => {
			const markup = renderToStaticMarkup(
				createElement(KnobDial, { width, height, angle, accent: "#5fcab5" }),
			);
			expect(markup).toContain(`viewBox="0 0 ${width} ${height}"`);
			expect(markup).toContain(
				`<rect x="2" y="2" width="${width - 4}" height="${height - 4}" rx="4" fill="none" stroke="#5fcab5" stroke-width="2"`,
			);
			expect(markup).not.toMatch(/<circle|<line|rotate\(/);
			expect(markup).not.toMatch(/<path|<image|<filter|<text/);
		},
	);
});
