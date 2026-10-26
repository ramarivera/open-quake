import { clamp, type VelocitySample } from "./scroll-physics";
export const CHAT_FRICTION = 0.95;
export const CHAT_MIN_FLING = 3.5;
export const CHAT_MAX_VELOCITY = 90;
export const CHAT_MIN_SEGMENT_MS = 20;
export const CHAT_SLOW_MS = 320;
export const CHAT_SLOW_AVERAGE = 2.8;
export const CHAT_SLOW_RELEASE = 7.7;
export const CHAT_MAX_STEP = 96;
export const CHAT_FRAME_MS = 1000 / 60;
export function messageDragOffset(
	start: number,
	dy: number,
	current: number,
	max: number,
	dtMs: number,
): number {
	const target = clamp(start - dy, 0, max);
	return dtMs < CHAT_MIN_SEGMENT_MS
		? current + clamp(target - current, -CHAT_MAX_STEP, CHAT_MAX_STEP)
		: target;
}
export function messageReleaseVelocity(
	samples: readonly VelocitySample[],
): number {
	const last = samples.at(-1);
	if (!last) return 0;
	for (let index = samples.length - 2; index >= 0; index--) {
		const sample = samples[index];
		if (sample && last.time - sample.time >= CHAT_MIN_SEGMENT_MS)
			return clamp(
				((last.offset - sample.offset) / (last.time - sample.time)) *
					CHAT_FRAME_MS,
				-CHAT_MAX_VELOCITY,
				CHAT_MAX_VELOCITY,
			);
	}
	return 0;
}
export function shouldFlingMessages(
	velocity: number,
	duration: number,
	distance: number,
): boolean {
	if (Math.abs(velocity) < CHAT_MIN_FLING) return false;
	return (
		duration < CHAT_SLOW_MS ||
		((Math.abs(distance) / duration) * CHAT_FRAME_MS >= CHAT_SLOW_AVERAGE &&
			Math.abs(velocity) >= CHAT_SLOW_RELEASE)
	);
}
export function stepMessageFling(
	offset: number,
	velocity: number,
	max: number,
	dtMs: number,
) {
	const frames = clamp(dtMs / CHAT_FRAME_MS, 0.25, 2.5);
	const next = clamp(offset + velocity * frames, 0, max);
	const speed =
		next === 0 || next === max ? 0 : velocity * CHAT_FRICTION ** frames;
	return {
		offset: next,
		velocity: speed,
		done: Math.abs(speed) < CHAT_MIN_FLING * 0.5,
	};
}

/** Mounted chat scroll lifetime, including completion invalidation for moved child targets. */
export function mountMessageScroll(
	element: HTMLElement,
	reduced: () => boolean,
): () => void {
	let frame = 0,
		origin = 0,
		startedAt = 0,
		lastAt = 0;
	let active = false;
	let samples: VelocitySample[] = [];
	const max = () => Math.max(0, element.scrollHeight - element.clientHeight);
	const refresh = () =>
		element.dispatchEvent(
			new CustomEvent("quake-touch-rescan", { bubbles: true }),
		);
	const stop = () => {
		cancelAnimationFrame(frame);
		frame = 0;
	};
	const start = (event: Event): void => {
		if (!(event instanceof CustomEvent)) return;
		const d: unknown = event.detail;
		if (
			typeof d !== "object" ||
			d === null ||
			!("y" in d) ||
			!("startY" in d) ||
			typeof d.y !== "number" ||
			typeof d.startY !== "number"
		)
			return;
		const now = performance.now();
		if ("phase" in d && d.phase === "start") {
			stop();
			active = true;
			origin = element.scrollTop;
			startedAt = now;
			lastAt = now;
			samples = [{ offset: origin, time: now }];
		} else if (active) {
			element.scrollTop = messageDragOffset(
				origin,
				d.y - d.startY,
				element.scrollTop,
				max(),
				now - lastAt,
			);
			lastAt = now;
			samples = [...samples, { offset: element.scrollTop, time: now }].slice(
				-12,
			);
		}
	};
	const end = (event: Event): void => {
		if (!active || !(event instanceof CustomEvent)) return;
		active = false;
		const d: unknown = event.detail;
		if (
			typeof d !== "object" ||
			d === null ||
			("cancelled" in d && d.cancelled === true) ||
			!("isEffective" in d) ||
			d.isEffective !== true ||
			reduced()
		) {
			stop();
			refresh();
			return;
		}
		const now = performance.now();
		let velocity = messageReleaseVelocity(samples);
		if (
			!shouldFlingMessages(
				velocity,
				now - startedAt,
				element.scrollTop - origin,
			)
		) {
			refresh();
			return;
		}
		let previous = now;
		const tick = (time: number): void => {
			if (reduced()) {
				stop();
				refresh();
				return;
			}
			const step = stepMessageFling(
				element.scrollTop,
				velocity,
				max(),
				time - previous,
			);
			previous = time;
			element.scrollTop = step.offset;
			velocity = step.velocity;
			if (step.done) {
				frame = 0;
				refresh();
			} else frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
	};
	element.addEventListener("quake-sub-touch-start", start);
	element.addEventListener("quake-sub-touch-end", end);
	return () => {
		active = false;
		stop();
		element.removeEventListener("quake-sub-touch-start", start);
		element.removeEventListener("quake-sub-touch-end", end);
	};
}
