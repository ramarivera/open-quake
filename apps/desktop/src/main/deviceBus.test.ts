import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MockDeviceBus, startMockDeviceBus } from "./mockDeviceBus";

describe("mock device bus", () => {
	let bus: MockDeviceBus;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(0);
		bus = startMockDeviceBus();
	});

	afterEach(() => {
		bus.stop();
		vi.useRealTimers();
	});

	it("reports a connected mock status and replays it to each subscriber", () => {
		const status = { source: "mock", kind: "status", state: "connected" };
		expect(bus.currentStatus()).toEqual(status);
		const first = vi.fn();
		bus.on(first);
		expect(first).toHaveBeenCalledExactlyOnceWith(status);
		vi.advanceTimersByTime(6000);
		expect(bus.currentStatus()).toEqual(status);
		const late = vi.fn();
		bus.on(late);
		expect(late).toHaveBeenCalledExactlyOnceWith(status);
	});

	it("rotates every 1500ms, keeps alive every 3000ms, presses every 6000ms", () => {
		const listener = vi.fn();
		bus.on(listener);
		listener.mockClear();
		vi.advanceTimersByTime(1499);
		expect(listener).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(listener).toHaveBeenCalledExactlyOnceWith({
			source: "mock",
			kind: "rotate",
			direction: 1,
		});
		vi.advanceTimersByTime(1500);
		expect(listener.mock.calls.map(([event]) => event)).toEqual([
			{ source: "mock", kind: "rotate", direction: 1 },
			{ source: "mock", kind: "rotate", direction: 1 },
			{ source: "mock", kind: "keepalive", seq: 1 },
		]);
		vi.advanceTimersByTime(3000);
		expect(listener.mock.calls.map(([event]) => event)).toEqual([
			{ source: "mock", kind: "rotate", direction: 1 },
			{ source: "mock", kind: "rotate", direction: 1 },
			{ source: "mock", kind: "keepalive", seq: 1 },
			{ source: "mock", kind: "rotate", direction: 1 },
			{ source: "mock", kind: "rotate", direction: 1 },
			{ source: "mock", kind: "press" },
			{ source: "mock", kind: "keepalive", seq: 2 },
		]);
	});

	it("can reverse rotation direction", () => {
		vi.mocked(Math.random).mockReturnValue(1);
		const listener = vi.fn();
		bus.on(listener);
		listener.mockClear();
		vi.advanceTimersByTime(3000);
		expect(listener).toHaveBeenNthCalledWith(1, {
			source: "mock",
			kind: "rotate",
			direction: -1,
		});
		expect(listener).toHaveBeenNthCalledWith(2, {
			source: "mock",
			kind: "rotate",
			direction: 1,
		});
	});

	it("unsubscribes one listener without stopping the other", () => {
		const removed = vi.fn();
		const remaining = vi.fn();
		const off = bus.on(removed);
		bus.on(remaining);
		removed.mockClear();
		remaining.mockClear();
		off();
		vi.advanceTimersByTime(1500);
		expect(removed).not.toHaveBeenCalled();
		expect(remaining).toHaveBeenCalledTimes(1);
	});

	it("stop clears every timer and listener and is safe to repeat", () => {
		const subscribe = vi.spyOn(EventEmitter.prototype, "on");
		const listener = vi.fn();
		bus.on(listener);
		listener.mockClear();
		const emitter: unknown = subscribe.mock.contexts.at(-1);
		assert(emitter instanceof EventEmitter);
		expect(emitter.listenerCount("event")).toBe(1);
		expect(vi.getTimerCount()).toBe(4);
		bus.stop();
		bus.stop();
		expect(vi.getTimerCount()).toBe(0);
		expect(emitter.listenerCount("event")).toBe(0);
		emitter.emit("event", { source: "mock", kind: "press" });
		vi.advanceTimersByTime(12000);
		expect(listener).not.toHaveBeenCalled();
	});
});

describe("mock raw vendor touch", () => {
	it("parses raw frames, tracks IDs and synthesizes a 100ms up without native I/O", async () => {
		vi.useFakeTimers();
		const { SYNTHETIC_TOUCH_DOWN, SYNTHETIC_TOUCH_MOVE } = await import(
			"../../../../packages/device/src/touch/touch-fixtures"
		);
		const bus = startMockDeviceBus();
		const listener = vi.fn();
		bus.on(listener);
		listener.mockClear();
		bus.emitTouchReport(SYNTHETIC_TOUCH_DOWN);
		vi.advanceTimersByTime(50);
		bus.emitTouchReport(SYNTHETIC_TOUCH_MOVE);
		expect(listener.mock.calls.map(([e]) => e.points?.[0])).toEqual([
			{ touchId: "touch-1", action: 1, x: 120, y: 360 },
			{ touchId: "touch-1", action: 1, x: 128, y: 360 },
		]);
		vi.advanceTimersByTime(99);
		expect(listener).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(1);
		expect(listener.mock.lastCall?.[0].points[0]).toEqual({
			touchId: "touch-1",
			action: 0,
			x: 128,
			y: 360,
		});
		bus.stop();
		vi.advanceTimersByTime(10000);
		expect(listener).toHaveBeenCalledTimes(3);
		vi.useRealTimers();
	});
});
