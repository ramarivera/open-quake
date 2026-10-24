export interface Point {
	readonly x: number;
	readonly y: number;
}
export interface Rect extends Point {
	readonly width: number;
	readonly height: number;
}
export interface TouchView {
	readonly width: number;
	readonly height: number;
	readonly rotation: number;
}

export function normalizeTouch(point: Point, view: TouchView): Point {
	const rotation = ((view.rotation % 360) + 360) % 360;
	return rotation === 90 || rotation === 180
		? { x: view.width - point.x, y: point.y }
		: { x: point.x, y: view.height - point.y };
}
export const contains = (rect: Rect, point: Point): boolean =>
	point.x >= rect.x &&
	point.x <= rect.x + rect.width &&
	point.y >= rect.y &&
	point.y <= rect.y + rect.height;
export const portraitBounds = (bounds: Rect, height: number): Rect => ({
	x: bounds.y,
	y: height - bounds.width - bounds.x,
	width: bounds.height,
	height: bounds.width,
});

/** Invert the panel root's rotation and viewport scale for DOM pointer input. */
export function clientToLogical(
	point: Point,
	bounds: Rect,
	rotation: number,
): Point {
	const x = (point.x - bounds.x) / bounds.width;
	const y = (point.y - bounds.y) / bounds.height;
	return rotation === 90
		? { x: y * 1920, y: (1 - x) * 480 }
		: { x: x * 1920, y: y * 480 };
}
