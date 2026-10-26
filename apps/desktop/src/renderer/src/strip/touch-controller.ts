import type { QuakeEvent } from "../../../preload/quake";
import {
	contains,
	normalizeTouch,
	type Point,
	type Rect,
	type TouchView,
} from "./touch-geometry";
import { createTapRecognizer } from "./touch-gestures";

export interface SubTouchTarget {
	readonly id: string;
	readonly bounds: Rect;
	readonly scrollable: boolean;
	readonly scale?: number;
}
/** strip-grid owns geometry and may return extra fields structurally. */
export interface TouchTile {
	readonly keyCode: string;
	readonly supportTouchEffect: boolean;
	readonly subTargets?: readonly SubTouchTarget[];
}
export type TileAt<Layout> = (
	point: Point,
	layout: Layout,
) => TouchTile | undefined;
export interface StripKeyEvent {
	readonly keyCode: string;
	readonly keyAction: 0 | 1;
	readonly voiceTouchEnd?: true;
}
export interface SubTouchEvent extends Point {
	readonly keyCode: string;
	readonly subElementId: string;
	readonly phase: "start" | "move" | "end";
	readonly startX: number;
	readonly startY: number;
	readonly isEffective: boolean;
	readonly confirmedTap: boolean;
	readonly cancelled?: boolean;
}
interface SubGesture {
	readonly tile: TouchTile;
	target: SubTouchTarget;
	readonly start: Point;
	last: Point;
	cancelled: boolean;
	readonly tap: ReturnType<typeof createTapRecognizer>;
}
export function createStripTouchController<Layout>(options: {
	readonly view: () => TouchView;
	readonly layout: () => Layout;
	readonly tileAt: TileAt<Layout>;
	readonly onKey: (event: StripKeyEvent) => void;
	readonly onSubTouch: (event: SubTouchEvent) => void;
	readonly onTileTap?: (keyCode: string) => void;
	readonly overlay: {
		readonly active: () => boolean;
		readonly point: (point: Point, action: 0 | 1) => void;
	};
	readonly now: () => number;
	readonly schedule: (action: () => void, delay: number) => () => void;
}) {
	let held: string | undefined, sub: SubGesture | undefined;
	let contactActive = false;
	let heldTap: ReturnType<typeof createTapRecognizer> | undefined;
	let overlayOwns = false,
		disposed = false;
	const releases = new Map<string, () => void>();
	const emitSub = (
		gesture: SubGesture,
		point: Point,
		phase: SubTouchEvent["phase"],
		effective = false,
		tap = false,
		cancelled = false,
	): void =>
		options.onSubTouch({
			keyCode: gesture.tile.keyCode,
			subElementId: gesture.target.id,
			phase,
			...point,
			startX: gesture.start.x,
			startY: gesture.start.y,
			isEffective: effective,
			confirmedTap: tap,
			...(cancelled ? { cancelled: true } : {}),
		});
	const release = (delay: number): void => {
		if (!held) return;
		const keyCode = held;
		held = undefined;
		releases.set(
			keyCode,
			options.schedule(() => {
				releases.delete(keyCode);
				options.onKey({ keyCode, keyAction: 1, voiceTouchEnd: true });
			}, delay),
		);
	};
	const endSub = (point: Point): void => {
		if (!sub) return;
		if (sub.cancelled) {
			sub = undefined;
			return;
		}
		const tapped = !sub.target.scrollable && sub.tap.end(point, options.now());
		emitSub(sub, point, "end", sub.target.scrollable || tapped, tapped);
		sub = undefined;
	};
	return {
		event(event: QuakeEvent, releaseDelay = 10): void {
			if (disposed) return;
			if (event.kind === "status" && event.state !== "connected") {
				// Link loss cancels touch ownership. It is never a successful voice
				// touch end; main resets GridVoice from this same status report.
				for (const [keyCode, cancel] of releases) {
					cancel();
					options.onKey({ keyCode, keyAction: 1 });
				}
				releases.clear();
				if (held) options.onKey({ keyCode: held, keyAction: 1 });
				held = undefined;
				if (sub) {
					emitSub(sub, sub.last, "end", false, false, true);
					sub = undefined;
				}
				overlayOwns = false;
				contactActive = false;
				heldTap = undefined;
				return;
			}
			if (event.kind !== "touch" || !event.points.length) return;
			const first = event.points[0];
			if (!first) return;
			const point = normalizeTouch(first, options.view());
			const action = first.action === 0 ? 0 : 1;
			if (overlayOwns || options.overlay.active()) {
				if (!overlayOwns) {
					for (const [keyCode, cancel] of releases) {
						cancel();
						options.onKey({ keyCode, keyAction: 1 });
					}
					releases.clear();
					if (held) options.onKey({ keyCode: held, keyAction: 1 });
					held = undefined;
					heldTap = undefined;
					if (sub) {
						emitSub(sub, sub.last, "end", false, false, true);
						sub = undefined;
					}
				}
				overlayOwns = action === 1;
				contactActive = action === 1;
				options.overlay.point(point, action);
				return;
			}
			if (action === 0) {
				contactActive = false;
				if (held && heldTap?.end(point, options.now()))
					options.onTileTap?.(held);
				heldTap = undefined;
				release(releaseDelay);
				endSub(point);
				return;
			}
			if (held) {
				heldTap?.move(point);
				return;
			}
			if (sub) {
				if (sub.cancelled) return;
				if (sub.last.x === point.x && sub.last.y === point.y) return;
				if (!sub.target.scrollable && sub.tap.move(point)) {
					emitSub(sub, point, "end");
					const scroll =
						sub.tile.subTargets?.find(
							(target) =>
								target.scrollable && target.id === "quakeBotIconViewMessages",
						) ?? sub.tile.subTargets?.find((target) => target.scrollable);
					if (!scroll) {
						sub.cancelled = true;
						sub.last = point;
						return;
					}
					sub.target = scroll;
					emitSub(sub, sub.start, "start");
				}
				if (sub.target.scrollable) emitSub(sub, point, "move");
				sub.last = point;
				return;
			}
			if (contactActive) return;
			contactActive = true;
			const tile = options.tileAt(point, options.layout());
			if (!tile) return;
			if (tile.supportTouchEffect || !tile.subTargets?.length) {
				// Preserve up-before-down ordering when another tap arrives inside 10 ms.
				for (const [keyCode, cancel] of releases) {
					cancel();
					options.onKey({ keyCode, keyAction: 1, voiceTouchEnd: true });
				}
				releases.clear();
				held = tile.keyCode;
				heldTap = createTapRecognizer(point, options.now());
				options.onKey({ keyCode: held, keyAction: 0 });
				return;
			}
			const hits = tile.subTargets?.filter((target) =>
				contains(target.bounds, point),
			);
			const target = hits?.find((target) => !target.scrollable) ?? hits?.[0];
			if (!target) return;
			sub = {
				tile,
				target,
				start: point,
				last: point,
				cancelled: false,
				tap: createTapRecognizer(point, options.now(), target.scale),
			};
			emitSub(sub, point, "start");
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			for (const [keyCode, cancel] of releases) {
				cancel();
				options.onKey({ keyCode, keyAction: 1 });
			}
			releases.clear();
			if (held) options.onKey({ keyCode: held, keyAction: 1 });
			held = undefined;
			if (sub) {
				emitSub(sub, sub.last, "end", false, false, true);
				sub = undefined;
			}
		},
	};
}
