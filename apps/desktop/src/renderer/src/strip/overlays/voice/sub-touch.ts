import { type RefObject, useEffect, useRef } from "react";
import {
	messageDragOffset,
	messageReleaseVelocity,
	shouldFlingMessages,
	stepMessageFling,
} from "../../message-scroll";
import type { VelocitySample } from "../../scroll-physics";

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

/**
 * ClawBotView's message scroll (quakeMessagesTouchScroll.js, AI-163) with
 * strip-touch's chat physics: 1:1 drag capped at 96 px per fast event, then a
 * fling only for a quick flick. Reduced motion drags without flinging.
 */
export function useSubTouchMessages(
	ref: RefObject<HTMLElement | null>,
	motion: "full" | "reduce",
): void {
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		let origin = 0;
		let startedAt = 0;
		let lastAt = 0;
		let samples: VelocitySample[] = [];
		let frame = 0;
		const max = (): number =>
			Math.max(0, element.scrollHeight - element.clientHeight);
		const onStart = (event: Event): void => {
			const detail = detailOf(event);
			if (!detail) return;
			const now = performance.now();
			if (detail.phase === "start") {
				cancelAnimationFrame(frame);
				origin = element.scrollTop;
				startedAt = now;
				lastAt = now;
				samples = [{ offset: origin, time: now }];
				return;
			}
			element.scrollTop = messageDragOffset(
				origin,
				detail.y - detail.startY,
				element.scrollTop,
				max(),
				now - lastAt,
			);
			lastAt = now;
			samples = [...samples, { offset: element.scrollTop, time: now }].slice(
				-12,
			);
		};
		const onEnd = (event: Event): void => {
			if (!detailOf(event) || motion === "reduce") return;
			const now = performance.now();
			let velocity = messageReleaseVelocity(samples);
			if (
				!shouldFlingMessages(
					velocity,
					now - startedAt,
					element.scrollTop - origin,
				)
			)
				return;
			let previous = now;
			const tick = (time: number): void => {
				const step = stepMessageFling(
					element.scrollTop,
					velocity,
					max(),
					time - previous,
				);
				previous = time;
				element.scrollTop = step.offset;
				velocity = step.velocity;
				if (!step.done) frame = requestAnimationFrame(tick);
			};
			frame = requestAnimationFrame(tick);
		};
		element.addEventListener("quake-sub-touch-start", onStart);
		element.addEventListener("quake-sub-touch-end", onEnd);
		return () => {
			cancelAnimationFrame(frame);
			element.removeEventListener("quake-sub-touch-start", onStart);
			element.removeEventListener("quake-sub-touch-end", onEnd);
		};
	}, [ref, motion]);
}
