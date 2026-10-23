import { EventEmitter } from "node:events";
import type { QuakeEvent } from "../preload/quake";
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
};

export function startMockDeviceBus(): MockDeviceBus {
	const emitter = new EventEmitter<{ event: [event: QuakeEvent] }>();
	const timers: ReturnType<typeof setInterval>[] = [];
	let seq = 0;
	let direction: 1 | -1 = 1;

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

	return {
		currentStatus: () => undefined,
		on(listener) {
			emitter.on("event", listener);
			return () => emitter.off("event", listener);
		},
		stop() {
			for (const t of timers) clearInterval(t);
			emitter.removeAllListeners();
		},
	};
}
