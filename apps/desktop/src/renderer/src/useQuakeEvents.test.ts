import { describe, expect, it } from "vitest";
import type { QuakeEvent } from "../../preload/quake";
import { appendQuakeEvent, type QuakeEventState } from "./useQuakeEvents";

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

describe("renderer event statistics", () => {
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
