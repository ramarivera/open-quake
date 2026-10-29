import { Option } from "effect";
import { PANEL_CANVAS } from "../../../shared/display";
import {
	type Footprint,
	keyFootprint,
	type Profile,
	type ProfileKey,
	type ProfilePage,
	parseProfileCoordinate,
	QUAKE_LOGICAL_GRID,
} from "../../../shared/profiles";

/**
 * Pure layout for the QUAKE strip, from DK-Suite 0.4.95's
 * shared/unitControlThemes.js and QuakeShortCutView.vue. See
 * openspec/changes/strip-key-grid/design.md for the source lines.
 */

import { soundboardConfigured } from "./tiles/soundboard/soundboard-state";

export interface Rgb {
	readonly r: number;
	readonly g: number;
	readonly b: number;
}
export interface Point {
	readonly x: number;
	readonly y: number;
}
export interface Rect extends Point {
	readonly width: number;
	readonly height: number;
}

export type StripThemeName =
	| "commonBaseTheme"
	| "meetingAssistantTheme"
	| "systemInfoTheme"
	| "systemMonitorPanelTheme";
/** Which decorative layers a theme paints on the generic tile. */
export type StripLayers = "commonBase" | "systemInfo" | "none";
export interface StripTheme {
	readonly name: StripThemeName;
	readonly cellSize: number;
	readonly cellGap: number;
	readonly edgeGap: number;
	readonly borderRadius: number;
	/** Inset of the background layer as a fraction of one cell's height. */
	readonly unitInnerGap: number;
	readonly colorScheme: Rgb | undefined;
	readonly layers: StripLayers;
}

export const STRIP_CANVAS = PANEL_CANVAS;
/** One logical canvas for wallpaper, overlays, hit testing and every host. */
export function stripViewportScale(width: number, height: number): number {
	return Number.isFinite(width) &&
		Number.isFinite(height) &&
		width > 0 &&
		height > 0
		? Math.min(width / STRIP_CANVAS.width, height / STRIP_CANVAS.height)
		: 1;
}

/** Runtime empty slots carry coordinates only, independently of editor key defaults. */
export const runtimePlaceholder = (keyCode: string) => ({ keyCode });
/** DK's default tile accent, rgb(116,128,239) = #7480EF. */
export const DEFAULT_ACCENT: Rgb = { r: 116, g: 128, b: 239 };

export const STRIP_THEMES: Readonly<Record<StripThemeName, StripTheme>> = {
	commonBaseTheme: {
		name: "commonBaseTheme",
		cellSize: 216,
		cellGap: 24,
		edgeGap: 12,
		borderRadius: 48,
		unitInnerGap: 0,
		colorScheme: DEFAULT_ACCENT,
		layers: "commonBase",
	},
	meetingAssistantTheme: {
		name: "meetingAssistantTheme",
		cellSize: 236,
		cellGap: 4,
		edgeGap: 2,
		borderRadius: 24,
		unitInnerGap: 0.04,
		colorScheme: undefined,
		layers: "none",
	},
	// 8·221 + 7·20 + 2·10 = 1928: DK lets this theme overflow the canvas.
	systemInfoTheme: {
		name: "systemInfoTheme",
		cellSize: 221,
		cellGap: 20,
		edgeGap: 10,
		borderRadius: 48,
		unitInnerGap: 0,
		colorScheme: { r: 0, g: 255, b: 255 },
		layers: "systemInfo",
	},
	systemMonitorPanelTheme: {
		name: "systemMonitorPanelTheme",
		cellSize: 220,
		cellGap: 20,
		edgeGap: 10,
		borderRadius: 0,
		unitInnerGap: 0,
		colorScheme: undefined,
		layers: "none",
	},
};

export const MEETING_ASSISTANT_TYPES: ReadonlySet<string> = new Set([
	"liveAudioTranslate",
	"tempMeetingMinutes",
	"meetingRecordMark",
	"meetingMinutes",
]);
const MEETING_ASSISTANT_TITLES: ReadonlySet<string> = new Set([
	"会议助手",
	"Meeting Assistant",
	"MeetAI",
]);
const SYSTEM_INFO_TITLES: ReadonlySet<string> = new Set([
	"System Info",
	"SysView",
	"系统信息",
	"系统监控",
]);

const compatibilityText = (
	profile: Pick<Profile, "compatibility">,
	field: string,
): string =>
	Option.match(profile.compatibility, {
		onNone: () => "",
		onSome: (compatibility) => {
			const value = compatibility[field];
			return typeof value === "string" ? value.trim() : "";
		},
	});

/** resolveThemeStyleFromProfile, read from open-quake's profile fields. */
export function resolveProfileTheme(
	profile: Pick<Profile, "name" | "compatibility">,
): StripThemeName {
	const resourceId = compatibilityText(profile, "resourceId");
	if (resourceId === "1-1") return "meetingAssistantTheme";
	if (resourceId === "1-3") return "systemInfoTheme";
	const titleKey = compatibilityText(profile, "titleKey");
	if (titleKey === "meetingAssistant") return "meetingAssistantTheme";
	if (titleKey === "systemMonitor") return "systemInfoTheme";
	const title = profile.name.trim();
	if (MEETING_ASSISTANT_TITLES.has(title)) return "meetingAssistantTheme";
	if (SYSTEM_INFO_TITLES.has(title)) return "systemInfoTheme";
	const lower = title.toLowerCase();
	if (lower === "meetai" || lower === "meeting assistant")
		return "meetingAssistantTheme";
	if (lower === "system info" || lower === "sysview") return "systemInfoTheme";
	return "commonBaseTheme";
}

/** getThemeForCell: per-cell overrides on top of the profile theme. */
export function cellTheme(
	type: string,
	profileTheme: StripThemeName,
	meetingPage: boolean,
): StripThemeName {
	if (type === "systemMonitorPanel") return "systemMonitorPanelTheme";
	if (type === "cpuInfo" || type === "gpuInfo") return "systemInfoTheme";
	if (type === "mic" && meetingPage) return "meetingAssistantTheme";
	return profileTheme;
}

/** Pixel rectangle of a logical footprint in a theme's grid. */
export function footprintRect(
	theme: StripTheme,
	footprint: Pick<Footprint, "row" | "column" | "width" | "height">,
): Rect {
	const pitch = theme.cellSize + theme.cellGap;
	return {
		x: theme.edgeGap + (footprint.column - 1) * pitch,
		y: theme.edgeGap + (footprint.row - 1) * pitch,
		width:
			footprint.width * theme.cellSize + (footprint.width - 1) * theme.cellGap,
		height:
			footprint.height * theme.cellSize +
			(footprint.height - 1) * theme.cellGap,
	};
}

/** These ignore the edge padding and cover the whole canvas (QSC:4977-4999). */
const FULL_BLEED_TYPES: ReadonlySet<string> = new Set([
	"playAudio",
	"dkDesktopClock",
]);
/** shouldShowShortcutPressFx (QSC:1702-1708). */
const NO_PRESS_FEEDBACK_TYPES: ReadonlySet<string> = new Set([
	"quakeBot",
	"liveAudioTranslateDisplay",
	"aiChatView",
	"cameraView",
	"cameraControlView",
	"printerStatusView",
]);
/** fetchAllCurrentButtonAttributes overrides (QSC:3054-3112). */
const SUB_TOUCH_TYPES: ReadonlySet<string> = new Set([
	"aiChatView",
	"liveAudioTranslateDisplay",
	"quakeBot",
	"quakeBotInput",
	"systemMonitorPanel",
	"playAudio",
	"playAudioLegacy",
	"cameraControlView",
	"dkDesktopClock",
]);
const NO_TOUCH_EFFECT_TYPES: ReadonlySet<string> = new Set([
	...SUB_TOUCH_TYPES,
	"cameraView",
	"printerStatusView",
]);

export interface StripTile {
	readonly keyCode: string;
	readonly key: ProfileKey;
	readonly type: string;
	readonly footprint: Footprint;
	/** The slot drawn behind the tile; also its hit-test rectangle. */
	readonly slot: Rect;
	readonly slotRadius: number;
	/** The tile body. Equals the slot except for full-bleed tiles. */
	readonly box: Rect;
	readonly tileRadius: number;
	readonly cellTheme: StripThemeName;
	readonly fullBleed: boolean;
	readonly zIndex: number;
	readonly supportTouchEffect: boolean;
	readonly hasTouchableSubElements: boolean;
	readonly pressFeedback: boolean;
	readonly pressScale: boolean;
}
/** A grid cell no visible tile covers. */
export interface StripCell {
	readonly keyCode: string;
	readonly placeholder: ReturnType<typeof runtimePlaceholder>;
	readonly rect: Rect;
	/** Empty slots draw the dashed border; hidden ones are plain and inert. */
	readonly state: "empty" | "hidden";
}
export interface StripLayout {
	readonly theme: StripTheme;
	/** A vivid page hides the grid and shows the wallpaper. */
	readonly vivid: boolean;
	readonly tiles: readonly StripTile[];
	readonly cells: readonly StripCell[];
	/** Cells inside a tile's footprint other than its own slot. */
	readonly covered: readonly string[];
}

const area = (footprint: Footprint): number =>
	footprint.width * footprint.height;
const compareAnchors = (a: ProfileKey, b: ProfileKey): number => {
	const [ar = 0, ac = 0] = a.keyCode.split(",").map(Number);
	const [br = 0, bc = 0] = b.keyCode.split(",").map(Number);
	return ar - br || ac - bc;
};
const hasSubElementsFlag = (key: ProfileKey): boolean =>
	Option.match(key.config.compatibility, {
		onNone: () => false,
		onSome: (compatibility) => compatibility.hasTouchableSubElements === true,
	});

function placeTile(
	key: ProfileKey,
	footprint: Footprint,
	profileTheme: StripTheme,
	meetingPage: boolean,
): StripTile {
	const type = key.config.type;
	const fullBleed =
		FULL_BLEED_TYPES.has(type) &&
		(type !== "dkDesktopClock" ||
			(footprint.width === 8 && footprint.height === 2));
	const localSound = soundboardConfigured(key.config);
	const slot = fullBleed
		? { x: 0, y: 0, ...STRIP_CANVAS }
		: footprintRect(profileTheme, footprint);
	const tileTheme = cellTheme(type, profileTheme.name, meetingPage);
	return {
		keyCode: key.keyCode,
		key,
		type,
		footprint,
		slot,
		slotRadius:
			type === "playAudio" || type === "systemMonitorPanel"
				? 0
				: profileTheme.borderRadius,
		box: slot,
		// The strip draws the clock and the player square (UC:2683-2688, QSC:1092-1096).
		tileRadius: fullBleed ? 0 : STRIP_THEMES[tileTheme].borderRadius,
		cellTheme: tileTheme,
		fullBleed,
		zIndex: fullBleed ? 1 : area(footprint) > 1 ? 10 : 0,
		supportTouchEffect: localSound
			? true
			: NO_TOUCH_EFFECT_TYPES.has(type)
				? false
				: MEETING_ASSISTANT_TYPES.has(type) ||
					(type === "mic" && meetingPage) ||
					key.config.supportTouchEffect,
		hasTouchableSubElements:
			!localSound && (SUB_TOUCH_TYPES.has(type) || hasSubElementsFlag(key)),
		pressFeedback: !NO_PRESS_FEEDBACK_TYPES.has(type),
		pressScale: type !== "playAudio",
	};
}

const cellCode = (row: number, column: number): string => `${row},${column}`;

/**
 * Visible keys claim their footprint, largest first, then in row-major anchor
 * order. A key whose footprint touches a claimed cell is not drawn, so no two
 * tiles ever share a cell (DK lets hidden tiles keep covering, QSV:2737-2752).
 */
export function stripLayout(
	profile: Pick<Profile, "name" | "compatibility">,
	page: Pick<ProfilePage, "keys">,
	rows: 1 | 2 = 2,
): StripLayout {
	const theme = STRIP_THEMES[resolveProfileTheme(profile)];
	const meetingPage = page.keys.some((key) =>
		MEETING_ASSISTANT_TYPES.has(key.config.type),
	);
	const candidates = page.keys
		.filter((key) => key.config.type !== "" && key.config.display)
		.flatMap((key) =>
			Option.match(keyFootprint(key), {
				onNone: () => [],
				onSome: (footprint) =>
					footprint.row + footprint.height - 1 <= rows
						? [{ key, footprint }]
						: [],
			}),
		)
		.sort(
			(a, b) =>
				area(b.footprint) - area(a.footprint) || compareAnchors(a.key, b.key),
		);
	const claimed = new Map<string, string>();
	const tiles: StripTile[] = [];
	for (const { key, footprint } of candidates) {
		const cells = Array.from({ length: footprint.height }, (_, row) =>
			Array.from({ length: footprint.width }, (_, column) =>
				cellCode(footprint.row + row, footprint.column + column),
			),
		).flat();
		if (cells.some((cell) => claimed.has(cell))) continue;
		for (const cell of cells) claimed.set(cell, key.keyCode);
		tiles.push(placeTile(key, footprint, theme, meetingPage));
	}
	tiles.sort((a, b) => compareAnchors(a.key, b.key));
	const byCell = new Map(
		page.keys.flatMap((key) =>
			Option.isSome(parseProfileCoordinate(key.keyCode))
				? [[key.keyCode, key] as const]
				: [],
		),
	);
	const cells: StripCell[] = [];
	const covered: string[] = [];
	for (let row = 1; row <= rows; row++)
		for (let column = 1; column <= QUAKE_LOGICAL_GRID.columns; column++) {
			const code = cellCode(row, column);
			const owner = claimed.get(code);
			if (owner !== undefined) {
				if (owner !== code) covered.push(code);
				continue;
			}
			const key = byCell.get(code);
			cells.push({
				keyCode: code,
				placeholder: runtimePlaceholder(code),
				rect: footprintRect(theme, { row, column, width: 1, height: 1 }),
				state: key === undefined || key.config.type === "" ? "empty" : "hidden",
			});
		}
	return {
		theme,
		// DK (QuakeScreenView.vue:2612) also counts hidden colorfulScreen keys,
		// which blanks a page whose only vivid key is switched off; only a shown one counts here.
		vivid: page.keys.some(
			(key) => key.config.type === "colorfulScreen" && key.config.display,
		),
		tiles,
		cells,
		covered,
	};
}

/** What strip-touch needs from a hit (its TouchTile is structurally compatible). */
export interface StripHit {
	readonly keyCode: string;
	readonly type: string;
	readonly slot: Rect;
	readonly supportTouchEffect: boolean;
	readonly hasTouchableSubElements: boolean;
	readonly pressFeedback: boolean;
}

/**
 * The visible tile whose rendered slot contains a top-left canvas point.
 * Unlike DK's anchor-based table (QSC:3028-3151), the left half of a span that
 * grew inward is hit too. Gaps, padding, covered and empty cells return nothing.
 */
export function tileAt(
	point: Point,
	layout: Pick<StripLayout, "tiles" | "vivid">,
): StripHit | undefined {
	if (layout.vivid || !Number.isFinite(point.x) || !Number.isFinite(point.y))
		return undefined;
	return layout.tiles.find(
		({ slot }) =>
			point.x >= slot.x &&
			point.x <= slot.x + slot.width &&
			point.y >= slot.y &&
			point.y <= slot.y + slot.height,
	);
}
