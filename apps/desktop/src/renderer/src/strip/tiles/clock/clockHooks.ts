import { useEffect, useState } from "react";
import { msUntilNextTick } from "./clockTime";
import type { FlipTimers } from "./flipSequencer";

export interface TickerOptions {
	readonly seconds: boolean;
	readonly onTick: (now: Date) => void;
	readonly now?: () => Date;
	readonly timers?: FlipTimers;
	/** Visibility source; resynchronises immediately when shown again. */
	readonly visibility?: Pick<
		Document,
		"hidden" | "addEventListener" | "removeEventListener"
	>;
}

/**
 * Re-reads wall-clock time at each minute (or second) boundary and re-arms.
 * Labels always come from the current instant, so sleep, DST and timezone
 * changes are picked up on the next tick without replaying anything.
 */
export function startClockTicker({
	seconds,
	onTick,
	now = () => new Date(),
	timers = globalThis,
	visibility,
}: TickerOptions): () => void {
	let handle: unknown;
	let stopped = false;
	const tick = (): void => {
		if (stopped) return;
		const current = now();
		onTick(current);
		handle = timers.setTimeout(tick, msUntilNextTick(current, seconds));
	};
	const onVisibility = (): void => {
		if (visibility?.hidden) return;
		timers.clearTimeout(handle);
		tick();
	};
	visibility?.addEventListener("visibilitychange", onVisibility);
	handle = timers.setTimeout(tick, msUntilNextTick(now(), seconds));
	return () => {
		stopped = true;
		timers.clearTimeout(handle);
		visibility?.removeEventListener("visibilitychange", onVisibility);
	};
}

/** Host helper: the `now` prop for a visible `ClockTile`. */
export function useClockNow(seconds: boolean): Date {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		setNow(new Date());
		return startClockTicker({
			seconds,
			onTick: setNow,
			visibility: document,
		});
	}, [seconds]);
	return now;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
	if (typeof document === "undefined") return false;
	const os =
		typeof matchMedia === "function" && matchMedia(REDUCED_MOTION).matches;
	return os || document.documentElement.dataset.motion === "reduce";
}

/**
 * The OS preference or the app's appearance setting, which `useAppearance`
 * mirrors onto `<html data-motion>` in every window.
 */
export function useReducedMotion(): boolean {
	const [reduced, setReduced] = useState(prefersReducedMotion);
	useEffect(() => {
		const update = (): void => setReduced(prefersReducedMotion());
		const query =
			typeof matchMedia === "function" ? matchMedia(REDUCED_MOTION) : null;
		query?.addEventListener("change", update);
		const observer = new MutationObserver(update);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-motion"],
		});
		update();
		return () => {
			query?.removeEventListener("change", update);
			observer.disconnect();
		};
	}, []);
	return reduced;
}
