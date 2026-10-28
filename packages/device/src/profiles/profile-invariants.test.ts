import { describe, expect, it } from "@effect/vitest";
import { FastCheck as fc, Option } from "effect";
import { createEmptyProfileKey, type ProfileKey } from "./profile-contracts.js";
import { completeProfileKey } from "./profile-fixtures.js";
import { FORCED_TILE_SPANS } from "./profile-footprint.js";
import {
	isEmptyCell,
	layoutIssues,
	moveOrSwapProfileKeys,
	occupiedCells,
	parseProfileCoordinate,
} from "./profile-invariants.js";

const cell = fc.tuple(
	fc.integer({ min: 1, max: 2 }),
	fc.integer({ min: 1, max: 8 }),
);
const tile = (code: string): ProfileKey => {
	const key = completeProfileKey();
	return { ...key, keyCode: code, config: { ...key.config, size: [1, 1] } };
};
describe("logical layout invariants", () => {
	it.prop(
		"parses every logical cell without transposing row and column",
		[cell],
		([[row, column]]) => {
			expect(parseProfileCoordinate(`${row},${column}`)).toEqual(
				Option.some({ row, column }),
			);
		},
	);
	it.prop(
		"rejects off-grid coordinates",
		[fc.integer(), fc.integer()],
		([row, column]) => {
			fc.pre(row < 1 || row > 2 || column < 1 || column > 8);
			expect(Option.isNone(parseProfileCoordinate(`${row},${column}`))).toBe(
				true,
			);
		},
	);
	it.prop(
		"edge spans grow inward and oversized spans fail",
		[cell, fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: 4 })],
		([[row, column], width, height]) => {
			const key = tile(`${row},${column}`);
			const candidate = {
				...key,
				config: { ...key.config, size: [width, height] as const },
			};
			const valid = width <= 8 && height <= 2;
			const cells = occupiedCells(candidate);
			expect(cells.length).toBe(valid ? width * height : 0);
			expect(layoutIssues([candidate]).length === 0).toBe(valid);
			if (!valid) return;
			const startRow = Math.min(row, 3 - height);
			const startColumn = Math.min(column, 9 - width);
			// The anchor stays inside its own footprint; the rest is in bounds.
			expect(cells).toContain(`${row},${column}`);
			expect(cells[0]).toBe(`${startRow},${startColumn}`);
			for (const code of cells) {
				const [r = 0, c = 0] = code.split(",").map(Number);
				expect(r >= 1 && r <= 2 && c >= 1 && c <= 8).toBe(true);
			}
		},
	);
	it.prop(
		"forced spans ignore config.size",
		[cell, fc.constantFrom(...FORCED_TILE_SPANS.entries())],
		([[row, column], [type, [width, height]]]) => {
			const key = tile(`${row},${column}`);
			const forced = {
				...key,
				config: { ...key.config, type, size: [1, 1] as const },
			};
			expect(occupiedCells(forced).length).toBe(width * height);
			expect(occupiedCells(forced)).toContain(`${row},${column}`);
		},
	);
	it("matches DK-Suite's edge cases", () => {
		const at = (
			code: string,
			size: readonly [number, number],
			type = "hotkey",
		) => {
			const key = tile(code);
			return occupiedCells({ ...key, config: { ...key.config, type, size } });
		};
		expect(at("1,8", [2, 1])).toEqual(["1,7", "1,8"]);
		expect(at("2,3", [1, 2])).toEqual(["1,3", "2,3"]);
		expect(at("2,8", [2, 2])).toEqual(["1,7", "1,8", "2,7", "2,8"]);
		expect(at("2,7", [1, 1], "quakeBot")).toEqual([
			"1,5",
			"1,6",
			"1,7",
			"1,8",
			"2,5",
			"2,6",
			"2,7",
			"2,8",
		]);
		expect(at("1,6", [1, 1], "aiChatView")[0]).toBe("1,4");
		expect(at("2,4", [1, 1], "dkDesktopClock")).toHaveLength(16);
		expect(at("1,2", [1, 1], "__proto__")).toEqual(["1,2"]);
	});
	it.prop(
		"rejects duplicate anchors, visible overlap, and noninteger spans",
		[cell],
		([[row, column]]) => {
			const key = tile(`${row},${column}`);
			expect(
				layoutIssues([key, key]).some(
					(issue) => issue.reason === "duplicate-anchor",
				),
			).toBe(true);
			if (column < 8) {
				const wide = {
					...key,
					config: { ...key.config, size: [2, 1] as const },
				};
				expect(
					layoutIssues([wide, tile(`${row},${column + 1}`)]).some(
						(issue) => issue.reason === "overlap",
					),
				).toBe(true);
			}
			expect(
				occupiedCells({ ...key, config: { ...key.config, size: [1.5, 1] } }),
			).toEqual([]);
		},
	);
	it.prop(
		"empty placeholders are inert and can be covered",
		[cell],
		([[row, column]]) => {
			const key = createEmptyProfileKey(`${row},${column}`);
			expect(isEmptyCell(key)).toBe(true);
			expect(layoutIssues([key])).toEqual([]);
			expect(
				isEmptyCell({
					...key,
					config: {
						...key.config,
						actions: [{ type: "unsafe", value: "payload" }],
					},
				}),
			).toBe(false);
			if (column < 8) {
				const wide = {
					...tile(key.keyCode),
					config: { ...tile(key.keyCode).config, size: [2, 1] as const },
				};
				expect(
					layoutIssues([wide, createEmptyProfileKey(`${row},${column + 1}`)]),
				).toEqual([]);
			}
		},
	);
	it.prop(
		"moves and swaps preserve every configuration and leave input unchanged",
		[cell, cell, fc.string()],
		([fromCell, toCell, text]) => {
			const from = fromCell.join(",");
			const to = toCell.join(",");
			fc.pre(from !== to);
			const source = tile(from);
			const target = tile(to);
			const first = {
				...source,
				config: { ...source.config, title: { ...source.config.title, text } },
			};
			for (const keys of [
				[first],
				[first, createEmptyProfileKey(to)],
				[first, target],
			]) {
				const before = structuredClone(keys);
				const result = moveOrSwapProfileKeys(keys, from, to);
				expect(keys).toEqual(before);
				expect(result._tag).toBe("Applied");
				if (result._tag === "Applied") {
					expect(result.keys.find((key) => key.keyCode === to)?.config).toBe(
						first.config,
					);
					if (keys.length > 1)
						expect(
							result.keys.find((key) => key.keyCode === from)?.config,
						).toBe(keys[1]?.config);
				}
			}
		},
	);
	it("rejects a locked swap and a span collision without changing input", () => {
		const first = tile("1,1");
		const target = tile("1,4");
		const locked = {
			...target,
			config: {
				...target.config,
				type: "meetingRecordMark",
				basicEditableItems: Option.some({
					title: true,
					grid: true,
					icon: true,
					allowDelete: false,
					allowDrag: false,
				}),
			},
		};
		expect(moveOrSwapProfileKeys([first, locked], "1,1", "1,4")).toEqual({
			_tag: "Rejected",
			reason: "locked",
		});
		expect(
			moveOrSwapProfileKeys([completeProfileKey(), tile("1,4")], "1,1", "1,3"),
		).toEqual({ _tag: "Rejected", reason: "layout" });
	});
	it("hidden tiles do not collide with visible tiles", () => {
		const wide = completeProfileKey();
		const hidden = tile("1,2");
		expect(
			layoutIssues([
				wide,
				{ ...hidden, config: { ...hidden.config, display: false } },
			]),
		).toEqual([]);
	});
});
