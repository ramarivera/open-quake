import { EventEmitter } from "node:events";
import { Option } from "effect";
import {
	SYNTHETIC_TOUCH_DOWN,
	SYNTHETIC_TOUCH_EMPTY,
	SYNTHETIC_TOUCH_MOVE,
} from "../../../../packages/device/src/touch/touch-fixtures";
import {
	createTouchTracker,
	parseTouchReport,
} from "../../../../packages/device/src/touch/touch-invariants";
import type { DeviceStatusEvent, QuakeEvent } from "../preload/quake";
import type { DeviceBus } from "./deviceBus";

/**
 * Device event bus for the prototype.
 *
 * MOCK SOURCE, clearly labeled: emits synthetic rotation/press/keep-alive
 * events on timers. A real transport can implement the same DeviceBus contract
 * for the panel renderer and management window.
 */
const KEEPALIVE_INTERVAL_MS = 3000;

export type MockDeviceBus = DeviceBus & {
	stop(): void;
	/** Deterministic raw input for preview and tests. */
	emitTouchReport(report: Uint8Array): void;
	/** Deterministic link transitions through the same listeners as real HID. */
	emitStatus(event: DeviceStatusEvent): void;
};

/** Disable timed demo input for deterministic native fixtures. */
export function startMockDeviceBus(scripted = true): MockDeviceBus {
	const emitter = new EventEmitter<{ event: [event: QuakeEvent] }>();
	let status: DeviceStatusEvent = {
		source: "mock",
		kind: "status",
		state: "connected",
	};
	const timers: ReturnType<typeof setInterval>[] = [];
	let seq = 0;
	let direction: 1 | -1 = 1;
	let stopped = false;
	const touch = createTouchTracker();
	let idle: ReturnType<typeof setTimeout> | undefined;
	const emitTouchReport = (report: Uint8Array): void => {
		if (stopped) return;
		const parsed = parseTouchReport(report);
		if (Option.isNone(parsed)) return;
		if (idle !== undefined) clearTimeout(idle);
		const points = touch.frame(parsed.value);
		if (points.length)
			emitter.emit("event", { source: "mock", kind: "touch", points });
		idle = setTimeout(() => {
			idle = undefined;
			const points = touch.release();
			if (points.length)
				emitter.emit("event", { source: "mock", kind: "touch", points });
		}, 100);
	};

	if (scripted) {
		timers.push(
			setInterval(() => {
				if (Math.random() > 0.8) direction = direction === 1 ? -1 : 1;
				emitter.emit("event", {
					source: "mock",
					kind: "rotate",
					direction,
				} satisfies QuakeEvent);
			}, 1500),
		);
		timers.push(
			setInterval(() => {
				emitter.emit("event", {
					source: "mock",
					kind: "press",
				} satisfies QuakeEvent);
			}, 6000),
		);
		timers.push(
			setInterval(() => {
				seq += 1;
				emitter.emit("event", {
					source: "mock",
					kind: "keepalive",
					seq,
				} satisfies QuakeEvent);
			}, KEEPALIVE_INTERVAL_MS),
		);

		timers.push(
			setInterval(() => {
				emitTouchReport(SYNTHETIC_TOUCH_DOWN);
				emitTouchReport(SYNTHETIC_TOUCH_MOVE);
				emitTouchReport(SYNTHETIC_TOUCH_EMPTY);
			}, 10_000),
		);
	}

	return {
		emitTouchReport,
		emitStatus: (event) => {
			if (stopped) return;
			status = event;
			emitter.emit("event", event);
		},
		currentStatus: () => status,
		on(listener) {
			emitter.on("event", listener);
			listener(status);
			return () => emitter.off("event", listener);
		},
		stop() {
			stopped = true;
			if (idle !== undefined) clearTimeout(idle);
			for (const t of timers) clearInterval(t);
			emitter.removeAllListeners();
		},
	};
}
