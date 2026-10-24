import { clamp, createFlingRunner } from "../../scroll-physics";
import { createGestureRecognizer } from "../../touch-gestures";
/** Adapter only: the shared recognizer and fling runner own all gesture physics. */
export function mountDiskScroll(element: HTMLElement): () => void {
	const range = (): number =>
		Math.max(0, element.scrollHeight - element.clientHeight);
	const fling = createFlingRunner({
		clock: {
			now: () => performance.now(),
			request: (tick) => requestAnimationFrame(tick),
			cancel: (id) => cancelAnimationFrame(id),
		},
		apply: (delta) => {
			element.scrollTop = clamp(element.scrollTop + delta, 0, range());
		},
		isBounded: () => element.scrollTop <= 0 || element.scrollTop >= range(),
		reducedMotion: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
	});
	const gesture = createGestureRecognizer({
		width: 1920,
		height: 480,
		axis: "both",
		onMove: (move) => {
			if (move.axis === "vertical")
				element.scrollTop = clamp(element.scrollTop - move.dy, 0, range());
		},
		onEnd: (end) => {
			if (end.axis === "vertical") fling.run(-end.vy);
		},
	});
	const touch = (event: Event): void => {
		if (!(event instanceof CustomEvent)) return;
		const d: unknown = event.detail;
		if (
			typeof d !== "object" ||
			d === null ||
			!("x" in d) ||
			!("y" in d) ||
			typeof d.x !== "number" ||
			typeof d.y !== "number"
		)
			return;
		if ("phase" in d && d.phase === "start") {
			fling.stop();
			gesture.cancel();
		}
		if (event.type === "quake-sub-touch-end") {
			if ("isEffective" in d && d.isEffective)
				gesture.end({ x: d.x, y: d.y }, performance.now());
			else {
				fling.stop();
				gesture.cancel();
			}
		} else gesture.point({ x: d.x, y: d.y }, performance.now());
	};
	element.addEventListener("quake-sub-touch-start", touch);
	element.addEventListener("quake-sub-touch-end", touch);
	return () => {
		fling.stop();
		gesture.cancel();
		element.removeEventListener("quake-sub-touch-start", touch);
		element.removeEventListener("quake-sub-touch-end", touch);
	};
}
