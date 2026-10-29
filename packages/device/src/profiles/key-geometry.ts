import { Option } from "effect";
import {
	keyEditable,
	keyStructurallyLocked,
} from "./key-editing-invariants.js";
import type { ProfileKey } from "./profile-contracts.js";
import { hasForcedSpan, keySpan } from "./profile-footprint.js";
import {
	isEmptyCell,
	keyFootprint,
	layoutIssues,
	occupiedCells,
	parseProfileCoordinate,
} from "./profile-invariants.js";

export interface KeyGeometry {
	readonly destination?: string | undefined;
	readonly replaceOverlaps?: boolean | undefined;
	readonly placement?: boolean | undefined;
}
export type KeyLayoutResult =
	| { readonly _tag: "ready"; readonly keys: readonly ProfileKey[] }
	| { readonly _tag: "confirmation"; readonly keyCodes: readonly string[] }
	| {
			readonly _tag: "rejected";
			readonly reason?:
				| "outOfBounds"
				| "locked"
				| "sizeMismatch"
				| "spaceNotEnough";
	  };

/** Apply one editor draft to committed keys. Swaps retain both complete configs. */
export function editKeyLayout(
	keys: readonly ProfileKey[],
	key: ProfileKey,
	geometry: KeyGeometry = {},
): KeyLayoutResult {
	const original = keys.find((k) => k.keyCode === key.keyCode);
	const requested = geometry.destination ?? key.keyCode;
	const destination =
		requested !== key.keyCode &&
		!geometry.placement &&
		keySpan(key.config).some((n) => n > 1)
			? (keys.find(
					(other) =>
						// Its own footprint is a shift, not a swap with itself.
						other.keyCode !== key.keyCode &&
						!isEmptyCell(other) &&
						other.config.display &&
						occupiedCells(other).includes(requested),
				)?.keyCode ?? requested)
			: requested;
	const moving = destination !== key.keyCode;
	if (Option.isNone(parseProfileCoordinate(destination)))
		return { _tag: "rejected", reason: "outOfBounds" };
	if (geometry.placement) {
		if (original && keyStructurallyLocked(original))
			return { _tag: "rejected", reason: "locked" };
		const cells = new Set(occupiedCells(key));
		const overlaps = keys.filter(
			(other) =>
				!isEmptyCell(other) &&
				other.config.display &&
				occupiedCells(other).some((cell) => cells.has(cell)),
		);
		if (overlaps.some((other) => keyStructurallyLocked(other)))
			return { _tag: "rejected", reason: "locked" };
		if (overlaps.length && !geometry.replaceOverlaps)
			return {
				_tag: "confirmation",
				keyCodes: overlaps.map((other) => other.keyCode),
			};
		const next = [
			...keys.filter(
				(other) => other.keyCode !== key.keyCode && !overlaps.includes(other),
			),
			key,
		];
		return layoutIssues(next).length === 0
			? { _tag: "ready", keys: next }
			: { _tag: "rejected" };
	}
	if (original) {
		const sizeChanged = original.config.size.some(
			(n, i) => n !== key.config.size[i],
		);
		const footprintChanged = keySpan(original.config).some(
			(n, i) => n !== keySpan(key.config)[i],
		);
		if (
			((sizeChanged || footprintChanged) && !keyEditable(original, "grid")) ||
			(sizeChanged && hasForcedSpan(original.config)) ||
			(requested !== key.keyCode && isEmptyCell(key)) ||
			JSON.stringify(original.config.basicEditableItems) !==
				JSON.stringify(key.config.basicEditableItems)
		)
			return { _tag: "rejected" };
	}
	let next = [...keys.filter((k) => k.keyCode !== key.keyCode), key];
	if (moving) {
		const target = keys.find((k) => k.keyCode === destination);
		const movedCells = new Set(occupiedCells({ ...key, keyCode: destination }));
		const displacedCells = new Set(
			target ? occupiedCells({ ...target, keyCode: key.keyCode }) : [],
		);
		if (
			keys.some(
				(other) =>
					other.keyCode !== key.keyCode &&
					!isEmptyCell(other) &&
					keyStructurallyLocked(other) &&
					(other === target ||
						(other.config.display &&
							occupiedCells(other).some(
								(cell) => movedCells.has(cell) || displacedCells.has(cell),
							))),
			)
		)
			return { _tag: "rejected", reason: "locked" };

		// Hidden keys don't occupy rendered cells, but a move must not hide them
		// under another tile or leave selection pointing at that tile's owner.
		if (
			keys.some(
				(other) =>
					other.keyCode !== key.keyCode &&
					other !== target &&
					!isEmptyCell(other) &&
					other.config.display &&
					occupiedCells(other).some((cell) => movedCells.has(cell)),
			)
		)
			return { _tag: "rejected", reason: "spaceNotEnough" };

		if (
			target &&
			!isEmptyCell(target) &&
			keySpan(target.config).some((n, i) => n !== keySpan(key.config)[i])
		)
			return { _tag: "rejected", reason: "sizeMismatch" };
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
	if (overlaps.some((k) => keyStructurallyLocked(k)))
		return { _tag: "rejected", reason: "locked" };
	if (overlaps.length && !geometry.replaceOverlaps)
		return { _tag: "confirmation", keyCodes: overlaps.map((k) => k.keyCode) };
	const remaining = next.filter((k) => !overlaps.includes(k));
	return layoutIssues(remaining).length === 0
		? { _tag: "ready", keys: remaining }
		: { _tag: "rejected" };
}
