export interface Rect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}
export function pickerLayout(count: number) {
	const paged = count > 15;
	const n = paged ? 15 : Math.max(1, count);
	const columns =
		n <= 2 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : n === 9 ? 3 : n <= 12 ? 4 : 5;
	const rows = Math.max(1, Math.ceil(n / columns));
	const widthBound = (1880 - (paged ? 320 : 0) - (columns - 1) * 16) / columns;
	const heightBound = ((370 - (rows - 1) * 16) / rows) * 4;
	const height = Math.max(
		30,
		Math.round(
			Math.max(120, Math.floor(Math.min(widthBound, heightBound))) / 4,
		),
	);
	const width = height * 4;
	const x = (1920 - (columns * width + (columns - 1) * 16)) / 2;
	const y = 66 + (370 - (rows * height + (rows - 1) * 16)) / 2;
	return {
		paged,
		columns,
		rows,
		width,
		height,
		x,
		y,
		nameSize: Math.min(48, Math.max(26, Math.round(0.26 * height))),
	};
}
export function cardRect(count: number, offset: number): Rect {
	const layout = pickerLayout(count);
	return {
		x: layout.x + (offset % layout.columns) * (layout.width + 16),
		y: layout.y + Math.floor(offset / layout.columns) * (layout.height + 16),
		width: layout.width,
		height: layout.height,
	};
}
export const inside = (rect: Rect, x: number, y: number): boolean =>
	x >= rect.x &&
	y >= rect.y &&
	x < rect.x + rect.width &&
	y < rect.y + rect.height;
export type PickerTarget =
	| { readonly kind: "card"; readonly index: number }
	| { readonly kind: "page"; readonly delta: -1 | 1 }
	| { readonly kind: "blank" };
export function pickerTarget(
	count: number,
	page: number,
	x: number,
	y: number,
): PickerTarget {
	const start = page * 15;
	for (let index = start; index < Math.min(start + 15, count); index++)
		if (inside(cardRect(count, index - start), x, y))
			return { kind: "card", index };
	if (count > 15) {
		if (page > 0 && inside({ x: 20, y: 130, width: 160, height: 220 }, x, y))
			return { kind: "page", delta: -1 };
		if (
			page < Math.ceil(count / 15) - 1 &&
			inside({ x: 1740, y: 130, width: 160, height: 220 }, x, y)
		)
			return { kind: "page", delta: 1 };
	}
	return { kind: "blank" };
}
export const sameTarget = (a: PickerTarget, b: PickerTarget): boolean =>
	a.kind === "blank"
		? b.kind === "blank"
		: a.kind === "card"
			? b.kind === "card" && a.index === b.index
			: b.kind === "page" && a.delta === b.delta;
export function tileRect(
	keyCode: string,
	size: readonly [number, number] = [1, 1],
): Rect {
	const [row = 1, column = 1] = keyCode.split(",").map(Number);
	return {
		x: 10 + (column - 1) * 240,
		y: 10 + (row - 1) * 240,
		width: size[0] * 240 - 20,
		height: size[1] * 240 - 20,
	};
}
