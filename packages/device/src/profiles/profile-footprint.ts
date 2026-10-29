import { Option } from "effect";
import type { ProfileKey } from "./profile-contracts.js";
import { QUAKE_LOGICAL_GRID } from "./profile-grid.js";

export interface LogicalCell {
	readonly row: number;
	readonly column: number;
}
export type TileSpan = readonly [width: number, height: number];
/** One-based logical rectangle a key covers after edge anchoring. */
export interface Footprint {
	readonly row: number;
	readonly column: number;
	readonly width: number;
	readonly height: number;
}

/**
 * DK-Suite 0.4.95 lays these types out at a fixed span and ignores
 * `config.size` (QuakeShortCutView getAreaSize/getCellStyle, Utils
 * getActualDisplaySize, monitorStyleContract). Explicit Console keys opt into
 * saved sizes through their retained compatibility layout marker. Unmarked
 * keys keep the legacy span. One table replaces DK's four
 * disagreeing copies (MGMT-065). A Map keeps `__proto__` and friends inert.
 */
export const FORCED_TILE_SPANS: ReadonlyMap<string, TileSpan> = new Map([
	["obsStats", [2, 1]],
	["obsScreenshot", [2, 2]],
	["playAudio", [8, 2]],
	["dkDesktopClock", [8, 2]],
	["systemMonitorPanel", [8, 2]],
	["aiChatView", [5, 2]],
	["gameMode", [4, 2]],
	["quakeBot", [4, 2]],
	["cameraView", [3, 2]],
	["cameraControlView", [3, 2]],
	["printerStatusView", [2, 2]],
	["quakeBotInput", [2, 2]],
]);

export const effectiveSpan = (type: string, size: TileSpan): TileSpan =>
	FORCED_TILE_SPANS.get(type) ?? size;

/** The marker survives profile export/import without changing the storage schema. */
export const usesSavedTileSize = (
	type: string,
	compatibility: unknown,
): boolean =>
	(type === "dkDesktopClock" || type === "quakeBotInput") &&
	typeof compatibility === "object" &&
	compatibility !== null &&
	"layout" in compatibility &&
	compatibility.layout === "console";
export const hasForcedSpan = (config: ProfileKey["config"]): boolean =>
	FORCED_TILE_SPANS.has(config.type) &&
	!usesSavedTileSize(config.type, Option.getOrUndefined(config.compatibility));
export const keySpan = (config: ProfileKey["config"]): TileSpan =>
	hasForcedSpan(config) ? effectiveSpan(config.type, config.size) : config.size;

const isSpanLength = (value: number, limit: number): boolean =>
	Number.isInteger(value) && value >= 1 && value <= limit;

/**
 * Spans that would run past column 8 or row 2 grow inward, left or up, from
 * their anchor (approved parity decision 2; QuakeShortCutView getCellStyle).
 * Spans larger than the grid have no footprint.
 */
export const footprintAt = (
	anchor: LogicalCell,
	[width, height]: TileSpan,
): Option.Option<Footprint> => {
	const { rows, columns } = QUAKE_LOGICAL_GRID;
	if (!isSpanLength(width, columns) || !isSpanLength(height, rows))
		return Option.none();
	return Option.some({
		row: Math.min(anchor.row, rows + 1 - height),
		column: Math.min(anchor.column, columns + 1 - width),
		width,
		height,
	});
};

export const footprintCells = (footprint: Footprint): readonly string[] =>
	Array.from({ length: footprint.height }, (_, row) =>
		Array.from(
			{ length: footprint.width },
			(_, column) => `${footprint.row + row},${footprint.column + column}`,
		),
	).flat();
