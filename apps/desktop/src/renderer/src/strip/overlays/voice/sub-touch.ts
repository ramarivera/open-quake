import { type RefObject, useEffect, useRef } from "react";

/**
 * Consumers of strip-touch-input's sub-element events (PR #20): elements
 * marked `data-quake-sub-touch` receive non-bubbling `quake-sub-touch-start`
 * (phases start and move) and `quake-sub-touch-end` CustomEvents in strip
 * pixels (SCREEN-061, AI-206).
 */
interface SubTouchDetail {
	readonly phase: string;
	readonly y: number;
	readonly startY: number;
	readonly confirmedTap: boolean;
}
function detailOf(event: Event): SubTouchDetail | undefined {
	if (!(event instanceof CustomEvent)) return undefined;
	const detail: unknown = event.detail;
	if (typeof detail !== "object" || detail === null) return undefined;
	const phase = "phase" in detail ? detail.phase : undefined;
	const y = "y" in detail ? detail.y : undefined;
	const startY = "startY" in detail ? detail.startY : undefined;
	const confirmedTap = "confirmedTap" in detail ? detail.confirmedTap : false;
	return typeof phase === "string" &&
		typeof y === "number" &&
		typeof startY === "number"
		? { phase, y, startY, confirmedTap: confirmedTap === true }
		: undefined;
}

/** 1:1 delta drag with no fling, as the AI Copilot transcript scrolls (AI-195). */
export function useSubTouchDrag(ref: RefObject<HTMLElement | null>): void {
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		let origin = 0;
		const onStart = (event: Event): void => {
			const detail = detailOf(event);
			if (!detail) return;
			if (detail.phase === "start") origin = element.scrollTop;
			else element.scrollTop = origin - (detail.y - detail.startY);
		};
		element.addEventListener("quake-sub-touch-start", onStart);
		return () => element.removeEventListener("quake-sub-touch-start", onStart);
	}, [ref]);
}

/** Runs `onTap` for a confirmed tap (16 px slop, 500 ms). */
export function useSubTouchTap(
	ref: RefObject<HTMLElement | null>,
	onTap: () => void,
): void {
	const latest = useRef(onTap);
	latest.current = onTap;
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const onEnd = (event: Event): void => {
			if (detailOf(event)?.confirmedTap) latest.current();
		};
		element.addEventListener("quake-sub-touch-end", onEnd);
		return () => element.removeEventListener("quake-sub-touch-end", onEnd);
	});
}
