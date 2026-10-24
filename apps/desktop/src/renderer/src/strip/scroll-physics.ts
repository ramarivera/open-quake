export const SCROLL_AXIS_THRESHOLD = 8;
export const SCROLL_AXIS_RATIO = 1.2;
export const SCROLL_VELOCITY_WINDOW_MS = 100;
export const MIN_FLING = 0.15;
export const REST_VELOCITY = 0.02;
export const MAX_FLING_MS = 600;
export const FRAME_CLAMP_MS = 64;
export const DECAY_PER_SECOND = 0.05;
export const RUBBER_MAX = 32;
export const RUBBER_DAMPING = 0.5;
export const RUBBER_BACK_MS = 200;
export const clamp = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(max, value));
export const scrollRange = (content: number, viewport: number): number =>
	Math.max(0, Math.round(content - viewport));
export const isVerticalScroll = (dx: number, dy: number): boolean =>
	Math.abs(dy) >= SCROLL_AXIS_THRESHOLD &&
	Math.abs(dy) > Math.abs(dx) * SCROLL_AXIS_RATIO;
export interface VelocitySample {
	readonly offset: number;
	readonly time: number;
}
export const addVelocitySample = (
	samples: readonly VelocitySample[],
	sample: VelocitySample,
): readonly VelocitySample[] => {
	const next = [...samples, sample];
	while (
		next.length > 2 &&
		sample.time - (next[0]?.time ?? sample.time) > SCROLL_VELOCITY_WINDOW_MS
	)
		next.shift();
	return next;
};
export const scrollVelocity = (samples: readonly VelocitySample[]): number => {
	const first = samples[0],
		last = samples.at(-1);
	return first && last && last.time > first.time
		? (last.offset - first.offset) / (last.time - first.time)
		: 0;
};
export const rubberAmount = (overflow: number): number =>
	clamp(overflow * RUBBER_DAMPING, 0, RUBBER_MAX);
export function dragOffset(start: number, dy: number, max: number): number {
	if (max <= 0) return 0;
	const raw = start - dy;
	return raw < 0
		? -rubberAmount(-raw)
		: raw > max
			? max + rubberAmount(raw - max)
			: raw;
}
export function stepInertia(velocity: number, dtMs: number) {
	const dt = clamp(dtMs, 0, FRAME_CLAMP_MS),
		rate = Math.log(DECAY_PER_SECOND) / 1000;
	return {
		distance: (velocity * Math.expm1(rate * dt)) / rate,
		velocity: velocity * Math.exp(rate * dt),
	};
}
export const stopFling = (elapsed: number, velocity: number): boolean =>
	elapsed >= MAX_FLING_MS || Math.abs(velocity) <= REST_VELOCITY;
export function stepRubberBack(from: number, max: number, elapsed: number) {
	const t = clamp(elapsed / RUBBER_BACK_MS, 0, 1),
		target = clamp(from, 0, Math.max(0, max));
	return { offset: from + (target - from) * (1 - (1 - t) ** 3), done: t >= 1 };
}
export interface AnimationClock {
	readonly now: () => number;
	readonly request: (tick: () => void) => number;
	readonly cancel: (id: number) => void;
}
/** No idle frames. New gestures and unmount call stop; bounds end inertia immediately. */
export function createFlingRunner(options: {
	readonly clock: AnimationClock;
	readonly apply: (delta: number) => void;
	readonly isBounded: () => boolean;
	readonly reducedMotion: () => boolean;
}) {
	let pending: number | undefined;
	const stop = (): void => {
		if (pending !== undefined) options.clock.cancel(pending);
		pending = undefined;
	};
	return {
		stop,
		run(velocity: number): boolean {
			stop();
			if (
				!Number.isFinite(velocity) ||
				Math.abs(velocity) < MIN_FLING ||
				options.reducedMotion() ||
				options.isBounded()
			)
				return false;
			const start = options.clock.now();
			let last = start,
				current = velocity;
			const tick = (): void => {
				pending = undefined;
				const now = options.clock.now();
				if (now - start >= MAX_FLING_MS || options.reducedMotion()) return;
				const step = stepInertia(current, now - last);
				last = now;
				current = step.velocity;
				options.apply(step.distance);
				if (!options.isBounded() && !stopFling(now - start, current))
					pending = options.clock.request(tick);
			};
			pending = options.clock.request(tick);
			return true;
		},
	};
}
