import { inside, type PickerTarget, type Rect } from "./geometry";

export interface SceneSlot {
	readonly index: number;
	readonly position: "previous" | "selected" | "next";
	readonly rect: Rect;
}
export const sceneCloseRect: Rect = { x: 36, y: 372, width: 390, height: 96 };
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
	if (count > 15 && y >= 288 && y < 336) {
		const page = Math.floor(index / 15);
		if (page > 0 && x >= 36 && x < 126) return { kind: "page", delta: -1 };
		if (page < Math.ceil(count / 15) - 1 && x >= 142 && x < 232)
			return { kind: "page", delta: 1 };
	}
	for (const slot of sceneSlots(count, index))
		if (inside(slot.rect, x, y)) return { kind: "card", index: slot.index };
	return { kind: "blank" };
}
