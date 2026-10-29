import { KNOB_PROFILE_PAGE_SIZE } from "../../../../../shared/knob-contracts";
import { inside, type PickerTarget, type Rect } from "./geometry";

export interface SceneSlot {
	readonly index: number;
	readonly position: "previous" | "selected" | "next";
	readonly rect: Rect;
}
/** Logical canvas coordinates also position .scene-pages buttons in knob.css. */
export const scenePageRect = (delta: -1 | 1): Rect => ({
	x: delta === -1 ? 36 : 142,
	y: 288,
	width: 90,
	height: 48,
});
/** Unique neighbours, including one/two-profile menus and wraparound. */
export function sceneSlots(
	count: number,
	selected: number,
): readonly SceneSlot[] {
	if (count < 1) return [];
	const index = ((selected % count) + count) % count;
	return [
		...(count > 2
			? [
					{
						index: (index + count - 1) % count,
						position: "previous" as const,
						rect: { x: 494, y: 66, width: 400, height: 348 },
					},
				]
			: []),
		{
			index,
			position: "selected" as const,
			rect: { x: 914, y: 10, width: 568, height: 460 },
		},
		...(count > 1
			? [
					{
						index: (index + 1) % count,
						position: "next" as const,
						rect: { x: 1502, y: 66, width: 400, height: 348 },
					},
				]
			: []),
	];
}
export function sceneTarget(
	count: number,
	index: number,
	x: number,
	y: number,
): PickerTarget {
	if (count > KNOB_PROFILE_PAGE_SIZE) {
		const page = Math.floor(index / KNOB_PROFILE_PAGE_SIZE);
		if (page > 0 && inside(scenePageRect(-1), x, y))
			return { kind: "page", delta: -1 };
		if (
			page < Math.ceil(count / KNOB_PROFILE_PAGE_SIZE) - 1 &&
			inside(scenePageRect(1), x, y)
		)
			return { kind: "page", delta: 1 };
	}
	for (const slot of sceneSlots(count, index))
		if (inside(slot.rect, x, y)) return { kind: "card", index: slot.index };
	return { kind: "blank" };
}
