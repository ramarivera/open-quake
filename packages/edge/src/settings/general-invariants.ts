import type { WindowRectangle } from "./general-contracts.js";
/** Keep the full rectangle inside the best intersecting work area, or the primary area. */
export function reachableWindow(
	saved: WindowRectangle,
	areas: readonly WindowRectangle[],
): WindowRectangle | undefined {
	const overlap = (a: WindowRectangle) =>
		Math.max(
			0,
			Math.min(saved.x + saved.width, a.x + a.width) - Math.max(saved.x, a.x),
		) *
		Math.max(
			0,
			Math.min(saved.y + saved.height, a.y + a.height) - Math.max(saved.y, a.y),
		);
	const area = areas.reduce<WindowRectangle | undefined>(
		(best, candidate) =>
			!best || overlap(candidate) > overlap(best) ? candidate : best,
		undefined,
	);
	if (!area) return;
	const width = Math.min(saved.width, area.width);
	const height = Math.min(saved.height, area.height);
	return {
		x: Math.max(area.x, Math.min(saved.x, area.x + area.width - width)),
		y: Math.max(area.y, Math.min(saved.y, area.y + area.height - height)),
		width,
		height,
	};
}
