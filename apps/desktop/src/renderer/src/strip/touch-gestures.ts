import type { Point } from "./touch-geometry";

export const TAP_SLOP = 16;
export const TAP_MS = 500;
export const GESTURE_SLOP = 6;
export const GESTURE_MIN_AREA = 44;
export const GESTURE_MIN_SPAN = 24;
export const VELOCITY_WINDOW_MS = 120;
export const STALE_RELEASE_MS = 80;
export const MAX_VELOCITY = 5;
export type Axis = "horizontal" | "vertical";
interface Sample extends Point {
	readonly time: number;
}
export interface GestureMove {
	readonly axis: Axis;
	readonly dx: number;
	readonly dy: number;
}
export interface GestureEnd extends GestureMove {
	readonly vx: number;
	readonly vy: number;
}
const clampVelocity = (n: number): number =>
	Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, n));

/** Repeated point calls represent HID down/move; only end completes a gesture. */
export function createGestureRecognizer(options: {
	readonly axis?: Axis | "both";
	readonly width: number;
	readonly height: number;
	readonly onMove: (move: GestureMove) => void;
	readonly onEnd: (end: GestureEnd) => void;
}) {
	let start: Sample | undefined;
	let anchor: Sample | undefined;
	let axis: Axis | undefined;
	let total = { x: 0, y: 0 };
	let samples: Sample[] = [];
	const cancel = (): void => {
		start = undefined;
		anchor = undefined;
		axis = undefined;
		total = { x: 0, y: 0 };
		samples = [];
	};
	return {
		point(point: Point, time: number): void {
			if (
				![point.x, point.y, time].every(Number.isFinite) ||
				options.width < GESTURE_MIN_AREA ||
				options.height < GESTURE_MIN_AREA
			)
				return;
			if (!start || !anchor) {
				start = { ...point, time };
				anchor = start;
				samples = [start];
				return;
			}
			if (time < anchor.time) return;
			const dx = point.x - start.x,
				dy = point.y - start.y;
			if (!axis) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) < GESTURE_SLOP) return;
				axis =
					options.axis && options.axis !== "both"
						? options.axis
						: Math.abs(dx) >= Math.abs(dy)
							? "horizontal"
							: "vertical";
			}
			const move = {
				axis,
				dx: axis === "vertical" ? 0 : point.x - anchor.x,
				dy: axis === "horizontal" ? 0 : point.y - anchor.y,
			};
			if (!move.dx && !move.dy) return;
			anchor = { ...point, time };
			total = { x: total.x + move.dx, y: total.y + move.dy };
			samples.push(anchor);
			while (
				samples.length > 2 &&
				time - (samples[0]?.time ?? time) > VELOCITY_WINDOW_MS
			)
				samples.shift();
			options.onMove(move);
		},
		end(point: Point, time: number): void {
			const first = samples[0];
			if (
				axis &&
				anchor &&
				first &&
				Number.isFinite(time) &&
				time >= anchor.time &&
				Math.max(Math.abs(total.x), Math.abs(total.y)) >= GESTURE_MIN_SPAN
			) {
				const dt = time - first.time;
				const fresh = time - anchor.time <= STALE_RELEASE_MS && dt > 0;
				options.onEnd({
					axis,
					dx: total.x,
					dy: total.y,
					vx:
						fresh && axis === "horizontal"
							? clampVelocity((point.x - first.x) / dt)
							: 0,
					vy:
						fresh && axis === "vertical"
							? clampVelocity((point.y - first.y) / dt)
							: 0,
				});
			}
			cancel();
		},
		cancel,
	};
}

/** Crossing slop permanently forfeits a tap even when the finger returns. */
export function createTapRecognizer(start: Point, time: number) {
	let cancelled = false;
	return {
		move(point: Point): boolean {
			cancelled ||=
				!Number.isFinite(point.x) ||
				!Number.isFinite(point.y) ||
				Math.hypot(point.x - start.x, point.y - start.y) > TAP_SLOP;
			return cancelled;
		},
		end(point: Point, now: number): boolean {
			this.move(point);
			return !cancelled && now >= time && now - time <= TAP_MS;
		},
	};
}
