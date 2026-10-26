import { Option } from "effect";
import { keyEditable } from "./key-editing-invariants.js";
import type { ProfileKey } from "./profile-contracts.js";
import { effectiveSpan, FORCED_TILE_SPANS } from "./profile-footprint.js";
import {
	isEmptyCell,
	keyFootprint,
	layoutIssues,
	occupiedCells,
} from "./profile-invariants.js";

export interface KeyGeometry {
	readonly destination?: string | undefined;
	readonly replaceOverlaps?: boolean | undefined;
}
export type KeyLayoutResult =
	| { readonly _tag: "ready"; readonly keys: readonly ProfileKey[] }
	| { readonly _tag: "confirmation"; readonly keyCodes: readonly string[] }
	| { readonly _tag: "rejected" };

/** Apply one editor draft to committed keys. Swaps retain both complete configs. */
export function editKeyLayout(
	keys: readonly ProfileKey[],
	key: ProfileKey,
	geometry: KeyGeometry = {},
): KeyLayoutResult {
	const original = keys.find((k) => k.keyCode === key.keyCode);
	const destination = geometry.destination ?? key.keyCode;
	const moving = destination !== key.keyCode;
	if (original) {
		const sizeChanged = original.config.size.some(
			(n, i) => n !== key.config.size[i],
		);
		const footprintChanged = effectiveSpan(
			original.config.type,
			original.config.size,
		).some((n, i) => n !== effectiveSpan(key.config.type, key.config.size)[i]);
		if (
			((sizeChanged || footprintChanged) && !keyEditable(original, "grid")) ||
			(sizeChanged && FORCED_TILE_SPANS.has(original.config.type)) ||
			(moving && (!keyEditable(original, "allowDrag") || isEmptyCell(key))) ||
			JSON.stringify(original.config.basicEditableItems) !==
				JSON.stringify(key.config.basicEditableItems)
		)
			return { _tag: "rejected" };
	}
	let next = [...keys.filter((k) => k.keyCode !== key.keyCode), key];
	if (moving) {
		const target = keys.find((k) => k.keyCode === destination);
		if (target && !keyEditable(target, "allowDrag"))
			return { _tag: "rejected" };
		next = next.map((k) =>
			k === key
				? { ...k, keyCode: destination }
				: k === target
					? { ...k, keyCode: key.keyCode }
					: k,
		);
		// Moving never removes a third key, even after a replacement confirmation.
		return layoutIssues(next).length === 0
			? { _tag: "ready", keys: next }
			: { _tag: "rejected" };
	}
	if (Option.isNone(keyFootprint(key))) return { _tag: "rejected" };
	const cells = new Set(occupiedCells(key));
	const overlaps = next.filter(
		(k) =>
			k !== key &&
			!isEmptyCell(k) &&
			k.config.display &&
			key.config.display &&
			occupiedCells(k).some((cell) => cells.has(cell)),
	);
	if (
		overlaps.some(
			(k) => !keyEditable(k, "allowDelete") || !keyEditable(k, "allowDrag"),
		)
	)
		return { _tag: "rejected" };
	if (overlaps.length && !geometry.replaceOverlaps)
		return { _tag: "confirmation", keyCodes: overlaps.map((k) => k.keyCode) };
	const remaining = next.filter((k) => !overlaps.includes(k));
	return layoutIssues(remaining).length === 0
		? { _tag: "ready", keys: remaining }
		: { _tag: "rejected" };
}
