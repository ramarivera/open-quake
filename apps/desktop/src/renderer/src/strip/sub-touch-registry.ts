import type { SubTouchTarget } from "./touch-controller";
import {
	contains,
	type Point,
	portraitBounds,
	type Rect,
} from "./touch-geometry";

export interface RegistryEntry extends SubTouchTarget {
	readonly connected: () => boolean;
	readonly liveBounds: () => Rect;
}
/** Adapter owns observation. Resolution repairs stale rects and rescans only its tile. */
export function createSubTouchRegistry(scan: () => readonly RegistryEntry[]) {
	let entries = scan();
	let lastScan = Number.NEGATIVE_INFINITY;
	let dirty = false;
	const rescan = (now: number): void => {
		if (now - lastScan < 500) return;
		lastScan = now;
		dirty = false;
		const scanned = scan();
		if (scanned.length) entries = scanned;
	};
	const hits = (point: Point): RegistryEntry | undefined => {
		const candidates = entries
			.filter((entry) => entry.connected() && contains(entry.bounds, point))
			.reverse();
		return candidates.find((entry) => !entry.scrollable) ?? candidates[0];
	};
	return {
		invalidate(): void {
			dirty = true;
		},
		refresh(): void {
			entries = entries.map((entry) =>
				entry.connected() ? { ...entry, bounds: entry.liveBounds() } : entry,
			);
		},
		resolve(point: Point, now: number): RegistryEntry | undefined {
			// A known scroller can cover a newly mounted clickable. Membership
			// invalidation must be checked before accepting an existing hit.
			if (dirty) rescan(now);
			const hit = hits(point);
			if (hit) return hit;
			this.refresh();
			const repaired = hits(point);
			if (repaired) return repaired;
			rescan(now);
			return hits(point);
		},
		targets(): readonly SubTouchTarget[] {
			return entries.filter((entry) => entry.connected());
		},
	};
}
export const transposeSubTargets = (
	entries: readonly SubTouchTarget[],
	height: number,
): readonly SubTouchTarget[] =>
	entries.map((entry) => ({
		...entry,
		bounds: portraitBounds(entry.bounds, height),
	}));
