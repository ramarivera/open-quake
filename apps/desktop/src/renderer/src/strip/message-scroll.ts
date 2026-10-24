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
