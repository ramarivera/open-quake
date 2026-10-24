import { describe, expect, it } from "vitest";
import type { DeviceStatusEvent, QuakeEvent } from "../../preload/quake";
import {
	appendLinkEvent,
	appendQuakeEvent,
	initialQuakeEvents,
	type QuakeEventState,
	type QuakeEventsView,
} from "./useQuakeEvents";

function initialState(): QuakeEventState {
	return {
		events: [],
		eventsReceived: 0,
		rotations: 0,
		presses: 0,
		lastKeepAliveSeq: null,
		touchPoints: [],
	};
}

/** Mirrors the hook: both reducers see every event. */
function receive(
	previous: QuakeEventsView,
	event: QuakeEvent,
): QuakeEventsView {
	return {
		...appendQuakeEvent(previous, event),
		...appendLinkEvent(previous, event),
	};
}

describe("renderer connection state", () => {
	it("starts with no status report and no knob movement", () => {
		expect(initialQuakeEvents).toEqual({
			...initialState(),
			connection: null,
			knobSteps: 0,
		});
	});

	it("keeps the latest status report after it leaves the bounded log", () => {
		const connected: DeviceStatusEvent = {
			source: "hid",
			kind: "status",
			state: "connected",
		};
		const lost: DeviceStatusEvent = {
			source: "hid",
			kind: "status",
			state: "disconnected",
			reason: "transport-ended",
		};
		let state = receive(initialQuakeEvents, connected);
		expect(state.connection).toEqual(connected);
		for (let seq = 1; seq <= 120; seq += 1) {
			state = receive(state, { source: "hid", kind: "keepalive", seq });
		}
		expect(state.events.some((event) => event.kind === "status")).toBe(false);
		expect(state.connection).toEqual(connected);
		state = receive(state, lost);
		expect(state.connection).toEqual(lost);
		expect(state.lastKeepAliveSeq).toBeNull();
	});

	it("accumulates signed knob steps independently of the rotation count", () => {
		let state = initialQuakeEvents;
		for (const direction of [1, 1, 1, -1] as const) {
			state = receive(state, { source: "hid", kind: "rotate", direction });
		}
		expect(state.knobSteps).toBe(2);
		expect(state.rotations).toBe(4);
		expect(
			receive(state, { source: "hid", kind: "press", state: 1 }).knobSteps,
		).toBe(2);
		expect(initialQuakeEvents.knobSteps).toBe(0);
	});
});

describe("renderer event statistics", () => {
	it("counts one HID press/release cycle once while retaining both reports", () => {
		const down: QuakeEvent = { source: "hid", kind: "press", state: 1 };
		const up: QuakeEvent = { source: "hid", kind: "press", state: 0 };
		const pressed = appendQuakeEvent(initialState(), down);
		expect(pressed.presses).toBe(1);
		const released = appendQuakeEvent(pressed, up);
		expect(released.presses).toBe(1);
		expect(released.events).toEqual([down, up]);
		expect(released.eventsReceived).toBe(2);
		expect(appendQuakeEvent(initialState(), up).presses).toBe(0);
		expect(
			appendQuakeEvent(released, { source: "mock", kind: "press" }).presses,
		).toBe(2);
	});

	it.each<DeviceStatusEvent>([
		{ source: "hid", kind: "status", state: "disconnected", reason: "error" },
		{
			source: "hid",
			kind: "status",
			state: "error",
			error: {
				_tag: "QuakeDeviceNotFound",
				code: "QUAKE.DEVICE.NOT_FOUND",
				category: "unavailable",
			},
		},
	])(
		"invalidates the last pong on $state and waits for a new pong after reconnect",
		(status) => {
			const alive = appendQuakeEvent(initialState(), {
				source: "hid",
				kind: "keepalive",
				seq: 1,
			});
			expect(alive.lastKeepAliveSeq).toBe(1);
			const stale = appendQuakeEvent(alive, status);
			expect(stale.lastKeepAliveSeq).toBeNull();
			const reconnected = appendQuakeEvent(stale, {
				source: "hid",
				kind: "status",
				state: "connected",
			});
			expect(reconnected.lastKeepAliveSeq).toBeNull();
			expect(
				appendQuakeEvent(reconnected, {
					source: "hid",
					kind: "keepalive",
					seq: 2,
				}).lastKeepAliveSeq,
			).toBe(2);
			expect(alive.lastKeepAliveSeq).toBe(1);
		},
	);

	it("keeps cumulative counters and keep-alive after events leave the bounded log", () => {
		let state = initialState();
		const send = (event: QuakeEvent) => {
			state = appendQuakeEvent(state, event);
		};
		send({ source: "mock", kind: "keepalive", seq: 42 });
		for (let i = 0; i < 150; i += 1) {
			send({ source: "mock", kind: "rotate", direction: i % 2 === 0 ? 1 : -1 });
			send({ source: "hid", kind: "press" });
		}
		expect(state.events).toHaveLength(100);
		expect(state.rotations).toBe(150);
		expect(state.presses).toBe(150);
		expect(state.eventsReceived).toBe(301);
		expect(state.lastKeepAliveSeq).toBe(42);
		for (let seq = 43; seq < 143; seq += 1) {
			send({ source: "mock", kind: "keepalive", seq });
		}
		expect(state.events.every((event) => event.kind === "keepalive")).toBe(
			true,
		);
		expect(state.rotations).toBe(150);
		expect(state.presses).toBe(150);
		expect(state.eventsReceived).toBe(401);
		expect(state.lastKeepAliveSeq).toBe(142);
	});

	it("projects touch coordinates without changing totals or mutating earlier state", () => {
		const previous = initialState();
		const touch: QuakeEvent = {
			source: "hid",
			kind: "touch",
			points: [{ action: 1, x: 10, y: 20 }],
		};
		const next = appendQuakeEvent(previous, touch);
		expect(next.touchPoints).toEqual([{ x: 10, y: 20 }]);
		expect(next.events).toEqual([touch]);
		expect(next.eventsReceived).toBe(1);
		expect(next.rotations).toBe(0);
		expect(next.presses).toBe(0);
		expect(previous).toEqual(initialState());
		expect(
			appendQuakeEvent(next, { source: "mock", kind: "press" }).touchPoints,
		).toEqual([]);
	});
});
