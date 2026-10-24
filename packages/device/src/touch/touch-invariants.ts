import { Option } from "effect";
import {
	MAX_TOUCH_POINTS,
	type RawTouchPoint,
	TOUCH_MATCH_DISTANCE,
	type TrackedTouchPoint,
} from "./touch-contracts.js";

/** Vendor input is not a checksummed control-channel short command. */
export function parseTouchReport(
	bytes: Uint8Array,
): Option.Option<readonly RawTouchPoint[]> {
	const count = bytes[4];
	if (
		bytes[0] !== 0xa3 ||
		bytes[3] !== 0x1a ||
		count === undefined ||
		count > MAX_TOUCH_POINTS ||
		bytes.length < 5 + count * 5
	)
		return Option.none();
	const points: RawTouchPoint[] = [];
	for (let index = 0; index < count; index++) {
		const start = 5 + 5 * index;
		points.push({
			action: bytes[start] ?? 0,
			y: (bytes[start + 1] ?? 0) | ((bytes[start + 2] ?? 0) << 8),
			x: (bytes[start + 3] ?? 0) | ((bytes[start + 4] ?? 0) << 8),
		});
	}
	return Option.some(points);
}

/** Presence is authoritative, matching DK-Suite's _trackPoints, not raw action. */
export function createTouchTracker() {
	let active: readonly TrackedTouchPoint[] = [];
	let sequence = 0;
	const release = (): readonly TrackedTouchPoint[] => {
		const lifted = active.map(
			(point): TrackedTouchPoint => ({ ...point, action: 0 }),
		);
		active = [];
		return lifted;
	};
	return {
		frame(points: readonly RawTouchPoint[]): readonly TrackedTouchPoint[] {
			const used = new Set<number>();
			const events: TrackedTouchPoint[] = [];
			for (const previous of active) {
				let best = -1;
				let distance = Number.POSITIVE_INFINITY;
				points.forEach((point, index) => {
					const candidate = Math.hypot(
						point.x - previous.x,
						point.y - previous.y,
					);
					if (
						!used.has(index) &&
						candidate <= TOUCH_MATCH_DISTANCE &&
						candidate < distance
					) {
						distance = candidate;
						best = index;
					}
				});
				const match = points[best];
				if (match) {
					used.add(best);
					events.push({
						touchId: previous.touchId,
						action: 1,
						x: match.x,
						y: match.y,
					});
				} else events.push({ ...previous, action: 0 });
			}
			points.forEach((point, index) => {
				if (!used.has(index))
					events.push({
						touchId: `touch-${++sequence}`,
						action: 1,
						x: point.x,
						y: point.y,
					});
			});
			active = events.filter((point) => point.action === 1);
			return events;
		},
		release,
	};
}

export const touchRecoveryDelay = (cycle: number, empty: boolean): number =>
	Math.max(Math.min(10_000 + 5_000 * cycle, 30_000), empty ? 60_000 : 0);
