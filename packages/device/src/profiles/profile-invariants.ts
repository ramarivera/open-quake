import { Option, Predicate } from "effect";
import type { ProfileKey } from "./profile-contracts.js";
import {
	effectiveSpan,
	type Footprint,
	footprintAt,
	footprintCells,
	type LogicalCell,
} from "./profile-footprint.js";
import { QUAKE_LOGICAL_GRID } from "./profile-grid.js";

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

/** Shared by occupancy, the strip renderer, its preview and hit-testing. */
export const keyFootprint = (key: ProfileKey): Option.Option<Footprint> =>
	Option.flatMap(parseProfileCoordinate(key.keyCode), (anchor) =>
		footprintAt(anchor, effectiveSpan(key.config.type, key.config.size)),
	);

export const occupiedCells = (key: ProfileKey): readonly string[] =>
	Option.match(keyFootprint(key), {
		onNone: () => [],
		onSome: footprintCells,
	});

/** Inspect raw import records before Profile's layout refinement rejects them. */
export function profileOverflow(input: unknown): readonly {
	readonly id: string;
	readonly page: string;
	readonly keyCode: string;
	readonly name: string;
	readonly width: number;
	readonly height: number;
}[] {
	const pages = Array.isArray(input)
		? [{ id: "import-page", keys: input }]
		: Predicate.isRecord(input) && Array.isArray(input.pages)
			? input.pages
			: [];
	return pages.flatMap((page, pageIndex) => {
		if (!Predicate.isRecord(page) || !Array.isArray(page.keys)) return [];
		const seen = new Set<string>();
		let invalid =
			page.keys.filter(
				(key) =>
					key !== null &&
					(!Predicate.isRecord(key) || key.keyCode !== "0,1"),
			).length > 16;
		let itemNumber = 0;
		const items = page.keys.flatMap((key) => {
			if (!Predicate.isRecord(key) || key.keyCode === "0,1") return [];
			const config = Predicate.isRecord(key.config) ? key.config : {};
			const code = typeof key.keyCode === "string" ? key.keyCode : "?";
			const type = typeof config.type === "string" ? config.type : "";
			const size = Array.isArray(config.size) ? config.size : [];
			const [width, height] = effectiveSpan(type, [
				typeof size[0] === "number" ? size[0] : 1,
				typeof size[1] === "number" ? size[1] : 1,
			]);
			const footprint = Option.flatMap(parseProfileCoordinate(code), (anchor) =>
				footprintAt(anchor, [width, height]),
			);
			if (Option.isNone(footprint)) invalid = true;
			if (type && config.display !== false && Option.isSome(footprint))
				for (const cell of footprintCells(footprint.value)) {
					if (seen.has(cell)) invalid = true;
					seen.add(cell);
				}
			return [
				{
					id: `${pageIndex}:${itemNumber++}`,
					page: typeof page.id === "string" ? page.id : String(pageIndex + 1),
					keyCode: code,
					name:
						Predicate.isRecord(config.title) &&
						typeof config.title.text === "string"
							? config.title.text
							: type,
					width,
					height,
				},
			];
		});
		return invalid ? items : [];
	});
}

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
