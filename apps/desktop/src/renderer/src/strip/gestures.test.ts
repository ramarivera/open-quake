import { FastCheck } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	messageDragOffset,
	messageReleaseVelocity,
	shouldFlingMessages,
	stepMessageFling,
} from "./message-scroll";
import {
	addVelocitySample,
	createFlingRunner,
	dragOffset,
	isVerticalScroll,
	scrollVelocity,
	stepInertia,
	stepRubberBack,
	stopFling,
} from "./scroll-physics";
import { createGestureRecognizer, createTapRecognizer } from "./touch-gestures";

const finite = FastCheck.double({
	min: -1e6,
	max: 1e6,
	noNaN: true,
	noDefaultInfinity: true,
});
describe("reusable gestures and scroll physics", () => {
	it("axis lock, minimum area/span, repeated starts, velocity cap and stale lift", () => {
		const onMove = vi.fn(),
			onEnd = vi.fn();
		const r = createGestureRecognizer({ width: 44, height: 44, onMove, onEnd });
		r.point({ x: 0, y: 0 }, 0);
		r.point({ x: 1, y: 5 }, 1);
		expect(onMove).not.toHaveBeenCalled();
		r.point({ x: 1, y: 6 }, 2);
		r.point({ x: 100, y: 30 }, 3);
		r.point({ x: 100, y: 30 }, 4);
		r.end({ x: 100, y: 30 }, 4);
		expect(onMove).toHaveBeenCalledTimes(2);
		expect(onEnd).toHaveBeenLastCalledWith({
			axis: "vertical",
			dx: 0,
			dy: 30,
			vx: 0,
			vy: 5,
		});
		r.point({ x: 0, y: 0 }, 0);
		r.point({ x: 0, y: 30 }, 10);
		r.end({ x: 0, y: 30 }, 91);
		expect(onEnd.mock.lastCall?.[0].vy).toBe(0);
		const small = createGestureRecognizer({
			width: 43,
			height: 100,
			onMove,
			onEnd,
		});
		onMove.mockClear();
		small.point({ x: 0, y: 0 }, 0);
		small.point({ x: 0, y: 100 }, 10);
		expect(onMove).not.toHaveBeenCalled();
		onEnd.mockClear();
		r.point({ x: 0, y: 0 }, 0);
		r.point({ x: 10, y: 0 }, 10);
		r.end({ x: 10, y: 0 }, 11);
		expect(onEnd).not.toHaveBeenCalled();
	});
	it("tap slop is Euclidean and permanently cancels on excursions", () => {
		const r = createTapRecognizer({ x: 0, y: 0 }, 0);
		expect(r.move({ x: 12, y: 12 })).toBe(true);
		expect(r.end({ x: 0, y: 0 }, 1)).toBe(false);
		expect(
			createTapRecognizer({ x: 0, y: 0 }, 0).end({ x: 16, y: 0 }, 500),
		).toBe(true);
	});
	it("motion properties remain bounded for arbitrary finite drags/times/velocities", () => {
		FastCheck.assert(
			FastCheck.property(
				finite,
				finite,
				finite,
				FastCheck.integer({ min: 1, max: 10000 }),
				(start, dy, velocity, max) => {
					const offset = dragOffset(start, dy, max);
					expect(offset).toBeGreaterThanOrEqual(-32);
					expect(offset).toBeLessThanOrEqual(max + 32);
					const step = stepInertia(velocity, Math.abs(dy));
					expect(Math.abs(step.velocity)).toBeLessThanOrEqual(
						Math.abs(velocity),
					);
					expect(Math.abs(step.distance)).toBeLessThanOrEqual(
						Math.abs(velocity) * 64 + 1e-6,
					);
					const back = stepRubberBack(offset, max, 200);
					expect(back.done).toBe(true);
					expect(back.offset).toBeGreaterThanOrEqual(-1e-9);
					expect(back.offset).toBeLessThanOrEqual(max + 1e-9);
					expect(stopFling(600, velocity)).toBe(true);
				},
			),
		);
	});
	it("monitor axis, sample window, exponential decay and rubber timing match recovered constants", () => {
		expect(isVerticalScroll(0, 8)).toBe(true);
		expect(isVerticalScroll(10, 12)).toBe(false);
		let samples = addVelocitySample([], { time: 0, offset: 0 });
		samples = addVelocitySample(samples, { time: 20, offset: 20 });
		samples = addVelocitySample(samples, { time: 121, offset: 121 });
		expect(samples).toHaveLength(2);
		expect(scrollVelocity(samples)).toBe(1);
		expect(dragOffset(0, 1000, 500)).toBe(-32);
		expect(dragOffset(500, -1000, 500)).toBe(532);
		expect(dragOffset(0, 1000, 0)).toBe(0);
		expect(stepRubberBack(-32, 500, 100).offset).toBe(-4);
		expect(stepRubberBack(-32, 500, 200)).toEqual({ offset: 0, done: true });
		expect(stepInertia(1, 1000)).toEqual(stepInertia(1, 64));
		expect(stopFling(1, 0.02)).toBe(true);
	});
	it("runner schedules nothing for reduced motion/bounds and stops before a late frame can exceed 600ms", () => {
		let now = 0,
			reduced = false,
			bounded = false;
		const frames = new Map<number, () => void>();
		let id = 0;
		const apply = vi.fn();
		const runner = createFlingRunner({
			clock: {
				now: () => now,
				request: (f) => {
					frames.set(++id, f);
					return id;
				},
				cancel: (n) => {
					frames.delete(n);
				},
			},
			apply,
			isBounded: () => bounded,
			reducedMotion: () => reduced,
		});
		reduced = true;
		expect(runner.run(1)).toBe(false);
		expect(frames.size).toBe(0);
		reduced = false;
		bounded = true;
		expect(runner.run(1)).toBe(false);
		bounded = false;
		expect(runner.run(1)).toBe(true);
		now = 16;
		const first = frames.get(id);
		frames.delete(id);
		first?.();
		expect(apply).toHaveBeenCalledTimes(1);
		now = 601;
		const last = frames.get(id);
		frames.delete(id);
		last?.();
		expect(apply).toHaveBeenCalledTimes(1);
		expect(frames.size).toBe(0);
		runner.run(1);
		runner.stop();
		expect(frames.size).toBe(0);
	});
	it("message drag/flick policy uses last >=20ms segment and suppresses slow pans", () => {
		expect(messageDragOffset(0, -500, 0, 1000, 19)).toBe(96);
		expect(messageDragOffset(0, -500, 0, 1000, 20)).toBe(500);
		expect(
			messageReleaseVelocity([
				{ time: 0, offset: 0 },
				{ time: 99, offset: 0 },
				{ time: 119, offset: 120 },
			]),
		).toBe(90);
		expect(
			messageReleaseVelocity([
				{ time: 0, offset: 0 },
				{ time: 19, offset: 120 },
			]),
		).toBe(0);
		expect(shouldFlingMessages(3.5, 100, 100)).toBe(true);
		expect(shouldFlingMessages(3.49, 100, 100)).toBe(false);
		expect(shouldFlingMessages(7.6, 320, 1000)).toBe(false);
		expect(shouldFlingMessages(90, 320, 10)).toBe(false);
		expect(shouldFlingMessages(7.7, 320, 1000)).toBe(true);
		expect(stepMessageFling(500, 10, 1000, 1000 / 60)).toEqual({
			offset: 510,
			velocity: 9.5,
			done: false,
		});
		expect(stepMessageFling(999, 10, 1000, 1000 / 60)).toEqual({
			offset: 1000,
			velocity: 0,
			done: true,
		});
	});
});
