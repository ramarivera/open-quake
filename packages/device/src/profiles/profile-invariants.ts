import { Option } from "effect";
import type { ProfileKey } from "./profile-contracts.js";
import { QUAKE_LOGICAL_GRID } from "./profile-grid.js";

export interface LogicalCell {
	readonly row: number;
	readonly column: number;
}
export interface LayoutIssue {
	readonly reason:
		| "coordinate"
		| "span"
		| "duplicate-anchor"
		| "overlap"
		| "empty-cell";
	readonly keyCode: string;
}

export const parseProfileCoordinate = (
	code: string,
): Option.Option<LogicalCell> => {
	if (!/^[1-9]\d*,[1-9]\d*$/.test(code)) return Option.none();
	const [row, column] = code.split(",").map(Number);
	if (
		row === undefined ||
		column === undefined ||
		row > QUAKE_LOGICAL_GRID.rows ||
		column > QUAKE_LOGICAL_GRID.columns
	)
		return Option.none();
	return Option.some({ row, column });
};

export const isEmptyCell = (key: ProfileKey): boolean =>
	key.config.type === "" &&
	Option.isNone(key.childrenName) &&
	key.config.icon === "" &&
	key.config.actions.length === 0 &&
	Option.match(key.config.subActions, {
		onNone: () => true,
		onSome: (actions) => actions.length === 0,
	}) &&
	key.config.size[0] === 1 &&
	key.config.size[1] === 1 &&
	!key.config.supportKnob;

export const occupiedCells = (key: ProfileKey): readonly string[] => {
	const anchor = parseProfileCoordinate(key.keyCode);
	const [width, height] = key.config.size;
	if (
		Option.isNone(anchor) ||
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width < 1 ||
		height < 1 ||
		anchor.value.column + width - 1 > QUAKE_LOGICAL_GRID.columns ||
		anchor.value.row + height - 1 > QUAKE_LOGICAL_GRID.rows
	)
		return [];
	return Array.from({ length: height }, (_, row) =>
		Array.from(
			{ length: width },
			(_, column) =>
				`${anchor.value.row + row},${anchor.value.column + column}`,
		),
	).flat();
};

export const layoutIssues = (
	keys: readonly ProfileKey[],
): readonly LayoutIssue[] => {
	const issues: LayoutIssue[] = [];
	const anchors = new Set<string>();
	const occupied = new Set<string>();
	for (const key of keys) {
		if (Option.isNone(parseProfileCoordinate(key.keyCode)))
			issues.push({ reason: "coordinate", keyCode: key.keyCode });
		if (anchors.has(key.keyCode))
			issues.push({ reason: "duplicate-anchor", keyCode: key.keyCode });
		anchors.add(key.keyCode);
		const cells = occupiedCells(key);
		if (cells.length === 0)
			issues.push({ reason: "span", keyCode: key.keyCode });
		if (key.config.type === "") {
			if (!isEmptyCell(key))
				issues.push({ reason: "empty-cell", keyCode: key.keyCode });
			continue;
		}
		if (!key.config.display) continue;
		for (const cell of cells) {
			if (occupied.has(cell))
				issues.push({ reason: "overlap", keyCode: key.keyCode });
			occupied.add(cell);
		}
	}
	return issues;
};

export type CoordinateEditResult =
	| { readonly _tag: "Applied"; readonly keys: readonly ProfileKey[] }
	| {
			readonly _tag: "Rejected";
			readonly reason: "missing-anchor" | "locked" | "layout";
	  };

/** Move to an absent/placeholder cell, or swap two anchors. Configuration is shared unchanged. */
export const moveOrSwapProfileKeys = (
	keys: readonly ProfileKey[],
	from: string,
	to: string,
): CoordinateEditResult => {
	const source = keys.find((key) => key.keyCode === from);
	const target = keys.find((key) => key.keyCode === to);
	if (!source) return { _tag: "Rejected", reason: "missing-anchor" };
	if (
		[source, ...(target ? [target] : [])].some(
			(key) =>
				Option.isSome(key.config.basicEditableItems) &&
				!key.config.basicEditableItems.value.allowDrag,
		)
	)
		return { _tag: "Rejected", reason: "locked" };
	const moved = keys.map((key) =>
		key === source
			? { ...key, keyCode: to }
			: key === target
				? { ...key, keyCode: from }
				: key,
	);
	return layoutIssues(moved).length === 0
		? { _tag: "Applied", keys: moved }
		: { _tag: "Rejected", reason: "layout" };
};
