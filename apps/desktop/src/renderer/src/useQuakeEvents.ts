import { useEffect, useState } from "react";
import type { OpenQuakeBridge, QuakeEvent } from "../../preload/quake";

declare global {
	interface Window {
		openQuake?: OpenQuakeBridge;
	}
}

export type QuakeEventState = {
	events: QuakeEvent[];
	eventsReceived: number;
	rotations: number;
	presses: number;
	lastKeepAliveSeq: number | null;
	touchPoints: { x: number; y: number }[];
};

export function appendQuakeEvent(
	previous: QuakeEventState,
	event: QuakeEvent,
): QuakeEventState {
	const events = [...previous.events.slice(-99), event];

	const touchPoints = (event.kind === "touch" ? event.points : []).map((p) => ({
		x: p.x,
		y: p.y,
	}));
	return {
		events,
		eventsReceived: previous.eventsReceived + 1,
		rotations: previous.rotations + (event.kind === "rotate" ? 1 : 0),
		presses: previous.presses + (event.kind === "press" ? 1 : 0),
		lastKeepAliveSeq:
			event.kind === "keepalive" ? event.seq : previous.lastKeepAliveSeq,
		touchPoints,
	};
}

export function useQuakeEvents(): QuakeEventState {
	const [state, setState] = useState<QuakeEventState>({
		events: [],
		eventsReceived: 0,
		rotations: 0,
		presses: 0,
		lastKeepAliveSeq: null,
		touchPoints: [],
	});
	useEffect(() => {
		return window.openQuake?.onQuakeEvent((event) => {
			setState((previous) => appendQuakeEvent(previous, event));
		});
	}, []);
	return state;
}
