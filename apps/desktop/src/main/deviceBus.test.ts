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

	it("rotates every 1500ms, keeps alive every 3000ms, presses every 6000ms", () => {
		const listener = vi.fn();
		bus.on(listener);
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
		off();
		vi.advanceTimersByTime(1500);
		expect(removed).not.toHaveBeenCalled();
		expect(remaining).toHaveBeenCalledTimes(1);
	});

	it("stop clears every timer and listener and is safe to repeat", () => {
		const subscribe = vi.spyOn(EventEmitter.prototype, "on");
		const listener = vi.fn();
		bus.on(listener);
		const emitter: unknown = subscribe.mock.contexts.at(-1);
		assert(emitter instanceof EventEmitter);
		expect(emitter.listenerCount("event")).toBe(1);
		expect(vi.getTimerCount()).toBe(3);
		bus.stop();
		bus.stop();
		expect(vi.getTimerCount()).toBe(0);
		expect(emitter.listenerCount("event")).toBe(0);
		emitter.emit("event", { source: "mock", kind: "press" });
		vi.advanceTimersByTime(12000);
		expect(listener).not.toHaveBeenCalled();
	});
});
