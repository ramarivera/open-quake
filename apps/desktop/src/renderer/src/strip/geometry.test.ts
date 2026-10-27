import { describe, expect, it } from "@effect/vitest";
import { FastCheck as fc, Option } from "effect";
import {
	createEmptyProfileKey,
	FORCED_TILE_SPANS,
	layoutIssues,
	type ProfileKey,
} from "../../../shared/profiles";
import {
	cellTheme,
	resolveProfileTheme,
	runtimePlaceholder,
	type StripLayout,
	stripLayout,
	stripViewportScale,
	tileAt,
} from "./geometry";

const key = (
	keyCode: string,
	type: string,
	size: readonly [number, number] = [1, 1],
	display = true,
): ProfileKey => {
	const empty = createEmptyProfileKey(keyCode);
	return {
		...empty,
		childrenName: type === "" ? Option.none() : Option.some(type),
		config: { ...empty.config, type, size: [size[0], size[1]], display },
	};
};
const custom = { name: "Work", compatibility: Option.none() };
const layoutOf = (keys: readonly ProfileKey[]): StripLayout =>
	stripLayout(custom, { keys });

const allCells = Array.from({ length: 16 }, (_, index) => {
	const row = Math.floor(index / 8) + 1;
	return `${row},${(index % 8) + 1}`;
});
const tileCells = (tile: StripLayout["tiles"][number]): string[] =>
	Array.from({ length: tile.footprint.height }, (_, row) =>
		Array.from(
			{ length: tile.footprint.width },
			(_, column) =>
				`${tile.footprint.row + row},${tile.footprint.column + column}`,
		),
	).flat();
const overlaps = (
	a: { x: number; y: number; width: number; height: number },
	b: { x: number; y: number; width: number; height: number },
): boolean =>
	a.x < b.x + b.width &&
	b.x < a.x + a.width &&
	a.y < b.y + b.height &&
	b.y < a.y + a.height;

const arbitraryType = fc.constantFrom(
	"",
	"",
	"hotkey",
	"website",
	"mic",
	...FORCED_TILE_SPANS.keys(),
);
const arbitraryPage = fc
	.uniqueArray(fc.constantFrom(...allCells), { maxLength: 16 })
	.chain((codes) =>
		fc.tuple(
			...codes.map((code) =>
				fc
					.tuple(
						arbitraryType,
						fc.integer({ min: 1, max: 8 }),
						fc.integer({ min: 1, max: 2 }),
						fc.boolean(),
					)
					.map(([type, width, height, display]) =>
						type === ""
							? key(code, "")
							: key(code, type, [width, height], display),
					),
			),
		),
	);

describe("strip layout", () => {
	it.prop("no two tiles share a cell or a pixel", [arbitraryPage], ([keys]) => {
		const layout = layoutOf(keys);
		const seen = new Set<string>();
		for (const tile of layout.tiles)
			for (const cell of tileCells(tile)) {
				expect(seen.has(cell)).toBe(false);
				seen.add(cell);
			}
		const framed = layout.tiles.filter((tile) => !tile.fullBleed);
		for (const [index, a] of framed.entries())
			for (const b of framed.slice(index + 1))
				expect(overlaps(a.slot, b.slot)).toBe(false);
		// A full-bleed tile claims the whole grid, so nothing else renders.
		if (layout.tiles.some((tile) => tile.fullBleed))
			expect(layout.tiles).toHaveLength(1);
	});

	it.prop(
		"spans grow inward from their anchor and stay on the grid",
		[arbitraryPage],
		([keys]) => {
			for (const tile of layoutOf(keys).tiles) {
				const [row = 0, column = 0] = tile.keyCode.split(",").map(Number);
				const { width, height } = tile.footprint;
				expect(tile.footprint.column).toBe(Math.min(column, 9 - width));
				expect(tile.footprint.row).toBe(Math.min(row, 3 - height));
				expect(tile.footprint.column + width - 1).toBeLessThanOrEqual(8);
				expect(tile.footprint.row + height - 1).toBeLessThanOrEqual(2);
				expect(tileCells(tile)).toContain(tile.keyCode);
				const forced = FORCED_TILE_SPANS.get(tile.type);
				if (forced) expect([width, height]).toEqual(forced);
			}
		},
	);

	it.prop(
		"covered cells are hidden and every cell is drawn once",
		[arbitraryPage],
		([keys]) => {
			const layout = layoutOf(keys);
			const claimed = layout.tiles.flatMap(tileCells);
			const drawn = layout.cells.map((cell) => cell.keyCode);
			expect([...claimed, ...drawn].sort()).toEqual([...allCells].sort());
			for (const cell of layout.covered) {
				expect(claimed).toContain(cell);
				expect(drawn).not.toContain(cell);
				expect(layout.tiles.map((tile) => tile.keyCode)).not.toContain(cell);
			}
			// Hidden keys never render; empty keys never render as tiles.
			for (const tile of layout.tiles) {
				expect(tile.key.config.display).toBe(true);
				expect(tile.type).not.toBe("");
			}
		},
	);

	it.prop(
		"every visible key of a valid layout renders",
		[arbitraryPage],
		([keys]) => {
			fc.pre(layoutIssues(keys).length === 0);
			const visible = keys.filter(
				(entry) => entry.config.type !== "" && entry.config.display,
			);
			expect(layoutOf(keys).tiles).toHaveLength(visible.length);
		},
	);

	it.prop(
		"tileAt returns exactly the tile whose slot holds the point",
		[
			arbitraryPage,
			fc.integer({ min: -20, max: 1940 }),
			fc.integer({ min: -20, max: 500 }),
		],
		([keys, x, y]) => {
			const layout = layoutOf(keys);
			const hit = tileAt({ x, y }, layout);
			const holders = layout.tiles.filter(
				({ slot }) =>
					x >= slot.x &&
					x <= slot.x + slot.width &&
					y >= slot.y &&
					y <= slot.y + slot.height,
			);
			expect(hit?.keyCode).toBe(holders[0]?.keyCode);
			for (const cell of layout.cells)
				if (
					x > cell.rect.x &&
					x < cell.rect.x + cell.rect.width &&
					y > cell.rect.y &&
					y < cell.rect.y + cell.rect.height
				)
					expect(hit).toBeUndefined();
		},
	);
});

describe("DK-Suite geometry", () => {
	it("places a common-base grid on the 1920×480 canvas", () => {
		const layout = layoutOf([key("2,1", "hotkey")]);
		expect(layout.theme.name).toBe("commonBaseTheme");
		expect(layout.tiles[0]?.slot).toEqual({
			x: 10,
			y: 250,
			width: 220,
			height: 220,
		});
		expect(layout.tiles[0]?.slotRadius).toBe(48);
		expect(layout.cells.find((cell) => cell.keyCode === "1,8")?.rect).toEqual({
			x: 1690,
			y: 10,
			width: 220,
			height: 220,
		});
	});

	it("uses MeetAI's 236/4/2 grid and radius 24", () => {
		const layout = stripLayout(
			{ name: "Mine", compatibility: Option.some({ resourceId: "1-1" }) },
			{ keys: [key("1,8", "mic")] },
		);
		expect(layout.theme.name).toBe("meetingAssistantTheme");
		expect(layout.tiles[0]?.slot).toEqual({
			x: 1682,
			y: 2,
			width: 236,
			height: 236,
		});
		expect(layout.tiles[0]?.slotRadius).toBe(24);
	});

	it("lets system info overflow the canvas by 8 px like DK", () => {
		const layout = stripLayout(
			{ name: "SysView", compatibility: Option.none() },
			{ keys: [key("2,8", "hotkey")] },
		);
		expect(layout.tiles[0]?.slot).toEqual({
			x: 1697,
			y: 251,
			width: 221,
			height: 221,
		});
	});

	it("grows right-edge and bottom-row spans inward", () => {
		const wide = layoutOf([key("1,8", "hotkey", [2, 1])]).tiles[0];
		expect(wide?.slot).toEqual({ x: 1450, y: 10, width: 460, height: 220 });
		const tall = layoutOf([key("2,3", "hotkey", [1, 2])]).tiles[0];
		expect(tall?.footprint).toMatchObject({ row: 1, column: 3, height: 2 });
		const bot = layoutOf([key("2,7", "quakeBot")]);
		expect(bot.tiles[0]?.footprint).toMatchObject({ row: 1, column: 5 });
		expect(bot.covered).toEqual([
			"1,5",
			"1,6",
			"1,7",
			"1,8",
			"2,5",
			"2,6",
			"2,8",
		]);
	});

	it("hides the placeholders under MeetAI's live translate panel", () => {
		const keys = [
			key("1,1", "liveAudioTranslateDisplay", [5, 2]),
			...["1,2", "1,3", "1,4", "1,5", "2,1", "2,2", "2,3", "2,4", "2,5"].map(
				(code) => key(code, ""),
			),
			key("1,6", "meetingMinutes", [1, 2]),
			key("2,6", ""),
		];
		const layout = layoutOf(keys);
		expect(layout.tiles.map((tile) => tile.keyCode)).toEqual(["1,1", "1,6"]);
		expect(layout.tiles[0]?.slot.width).toBe(1180);
		expect(layout.covered).toHaveLength(10);
		expect(layout.cells.map((cell) => cell.keyCode)).toEqual([
			"1,7",
			"1,8",
			"2,7",
			"2,8",
		]);
	});

	it("resolves a conflicting raw import in row-major order", () => {
		const layout = layoutOf([
			key("1,7", "hotkey", [2, 1]),
			key("1,8", "hotkey", [2, 1]),
		]);
		expect(layout.tiles.map((tile) => tile.keyCode)).toEqual(["1,7"]);
	});

	it("lays the clock and player over the full canvas, square", () => {
		for (const type of ["dkDesktopClock", "playAudio"]) {
			const tile = layoutOf([key("2,4", type)]).tiles[0];
			expect(tile?.box).toEqual({ x: 0, y: 0, width: 1920, height: 480 });
			expect(tile?.tileRadius).toBe(0);
			expect(tile?.zIndex).toBe(1);
			expect(tile?.hasTouchableSubElements).toBe(true);
			expect(tile?.supportTouchEffect).toBe(false);
		}
		expect(layoutOf([key("1,1", "playAudio")]).tiles[0]?.pressScale).toBe(
			false,
		);
	});

	it("keeps the monitor panel inside the padding with radius 0", () => {
		const tile = layoutOf([key("1,1", "systemMonitorPanel")]).tiles[0];
		expect(tile?.box).toEqual({ x: 10, y: 10, width: 1900, height: 460 });
		expect(tile?.cellTheme).toBe("systemMonitorPanelTheme");
		expect(tile?.tileRadius).toBe(0);
		expect(tile?.slotRadius).toBe(0);
	});

	it("hit-tests the rendered slot, not DK's anchor rectangle", () => {
		const layout = layoutOf([key("1,8", "hotkey", [2, 1])]);
		expect(tileAt({ x: 1500, y: 100 }, layout)?.keyCode).toBe("1,8");
		expect(tileAt({ x: 240, y: 100 }, layout)).toBeUndefined();
		expect(tileAt({ x: 1915, y: 100 }, layout)).toBeUndefined();
	});

	it("marks vivid pages and ignores touches on them", () => {
		const layout = layoutOf([key("1,1", "colorfulScreen")]);
		expect(layout.vivid).toBe(true);
		expect(tileAt({ x: 100, y: 100 }, layout)).toBeUndefined();
	});

	it("keeps the key grid when the page's colorfulScreen key is hidden", () => {
		const layout = layoutOf([
			key("1,1", "colorfulScreen", [1, 1], false),
			key("1,2", "hotkey"),
		]);
		expect(layout.vivid).toBe(false);
		expect(layout.tiles.map((tile) => tile.keyCode)).toEqual(["1,2"]);
		expect(tileAt({ x: 360, y: 100 }, layout)?.keyCode).toBe("1,2");
	});

	it("separates empty and hidden cells", () => {
		const layout = layoutOf([
			key("1,1", ""),
			key("1,2", "hotkey", [1, 1], false),
		]);
		expect(layout.tiles).toHaveLength(0);
		expect(layout.cells.find((cell) => cell.keyCode === "1,1")?.state).toBe(
			"empty",
		);
		expect(layout.cells.find((cell) => cell.keyCode === "1,2")?.state).toBe(
			"hidden",
		);
		expect(layout.cells.find((cell) => cell.keyCode === "2,8")?.state).toBe(
			"empty",
		);
	});

	it("applies DK's press and touch overrides", () => {
		const layout = layoutOf([
			key("1,1", "aiChatView"),
			key("1,6", "hotkey"),
			key("1,7", "printerStatusView"),
		]);
		const byCode = new Map(layout.tiles.map((tile) => [tile.keyCode, tile]));
		expect(byCode.get("1,1")?.pressFeedback).toBe(false);
		expect(byCode.get("1,6")?.pressFeedback).toBe(true);
		expect(byCode.get("1,7")?.pressFeedback).toBe(false);
		expect(byCode.get("1,7")?.supportTouchEffect).toBe(false);
		expect(byCode.get("1,7")?.footprint).toMatchObject({ width: 2, height: 2 });
		expect(layout.tiles).toHaveLength(3);
	});
});

describe("theme resolution", () => {
	const theme = (name: string, compatibility?: Record<string, string>) =>
		resolveProfileTheme({
			name,
			compatibility: compatibility ? Option.some(compatibility) : Option.none(),
		});
	it("follows resourceId, then titleKey, then exact and lowercase names", () => {
		expect(theme("Anything", { resourceId: "1-1" })).toBe(
			"meetingAssistantTheme",
		);
		expect(theme("MeetAI", { resourceId: "1-3" })).toBe("systemInfoTheme");
		expect(theme("x", { titleKey: "meetingAssistant" })).toBe(
			"meetingAssistantTheme",
		);
		expect(theme("x", { titleKey: "systemMonitor" })).toBe("systemInfoTheme");
		expect(theme("会议助手")).toBe("meetingAssistantTheme");
		expect(theme("系统监控")).toBe("systemInfoTheme");
		expect(theme("  meeting assistant ")).toBe("meetingAssistantTheme");
		expect(theme("SYSVIEW")).toBe("systemInfoTheme");
		expect(theme("MeetAI Notes")).toBe("commonBaseTheme");
		expect(theme("Quick")).toBe("commonBaseTheme");
	});
	it("overrides cell themes for panels, cpu/gpu and meeting mics", () => {
		expect(cellTheme("systemMonitorPanel", "commonBaseTheme", false)).toBe(
			"systemMonitorPanelTheme",
		);
		expect(cellTheme("gpuInfo", "commonBaseTheme", false)).toBe(
			"systemInfoTheme",
		);
		expect(cellTheme("mic", "commonBaseTheme", true)).toBe(
			"meetingAssistantTheme",
		);
		expect(cellTheme("mic", "commonBaseTheme", false)).toBe("commonBaseTheme");
		const page = layoutOf([key("1,1", "meetingMinutes"), key("1,2", "mic")]);
		expect(page.tiles[1]?.cellTheme).toBe("meetingAssistantTheme");
		expect(page.tiles[1]?.slot.width).toBe(220);
		expect(page.tiles[1]?.tileRadius).toBe(24);
	});
});

describe("strip burn-down geometry", () => {
	it("SCREEN-022 runtime cell records carry no unused configuration or event payload", () => {
		for (const cell of layoutOf([]).cells) {
			expect(cell.placeholder).not.toHaveProperty("config");
			expect(cell.placeholder).not.toHaveProperty("eventInfo");
			expect(cell.placeholder.keyCode).toBe(cell.keyCode);
		}
	});
	it("SCREEN-022 builds runtime placeholders without changing new-editor defaults or leaking old state", () => {
		expect(runtimePlaceholder("2,8")).toEqual({ keyCode: "2,8" });
		const empty = createEmptyProfileKey("2,8");
		expect(empty.config.title.display).toBe(true);
		const first = layoutOf([
			key("1,1", "hotkey"),
			key("2,8", "hotkey", [1, 1], false),
		]);
		expect(first.cells.find((c) => c.keyCode === "2,8")?.state).toBe("hidden");
		const next = layoutOf([]);
		expect(next.cells).toHaveLength(16);
		for (const cell of next.cells) {
			expect(cell.state).toBe("empty");
			expect(cell.placeholder).toEqual(runtimePlaceholder(cell.keyCode));
		}
		expect(empty.config.title.display).toBe(true);
	});
	it("SCREEN-023/029 keeps the panel slot and tile square", () => {
		const tile = layoutOf([key("1,1", "systemMonitorPanel")]).tiles[0];
		expect(tile).toMatchObject({
			slotRadius: 0,
			tileRadius: 0,
			cellTheme: "systemMonitorPanelTheme",
			zIndex: 10,
		});
	});
	it("MAIN-052 SCREEN-006/126/134 uniformly fits any positive host without changing logical hit targets", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 8000 }),
				fc.integer({ min: 1, max: 8000 }),
				(width, height) => {
					const scale = stripViewportScale(width, height);
					expect(scale).toBeGreaterThan(0);
					expect(1920 * scale).toBeLessThanOrEqual(width + 1e-8);
					expect(480 * scale).toBeLessThanOrEqual(height + 1e-8);
					const layout = layoutOf([key("2,8", "hotkey", [2, 2])]);
					const tile = layout.tiles[0];
					if (!tile) throw new Error("No tile");
					const point = {
						x: (tile.slot.x + 20) * scale,
						y: (tile.slot.y + 20) * scale,
					};
					expect(
						tileAt({ x: point.x / scale, y: point.y / scale }, layout)?.keyCode,
					).toBe("2,8");
				},
			),
		);
		for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
			expect(stripViewportScale(width, 480)).toBe(1);
		for (const height of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
			expect(stripViewportScale(1920, height)).toBe(1);
	});
});
