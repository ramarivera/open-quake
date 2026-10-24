import { useEffect, useState } from "react";
import type {
	DeviceStatusEvent,
	OpenQuakeBridge,
	QuakeEvent,
} from "../../preload/quake";

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

/** Link state that must outlive the bounded event log. */
export type DeviceLinkState = {
	/** Latest status report; null until the device service sends one. */
	connection: DeviceStatusEvent | null;
	/** Net knob detents (+1 per step one way, -1 the other) since launch. */
	knobSteps: number;
};

export type QuakeEventsView = QuakeEventState & DeviceLinkState;

export const initialQuakeEvents: QuakeEventsView = {
	events: [],
	eventsReceived: 0,
	rotations: 0,
	presses: 0,
	lastKeepAliveSeq: null,
	touchPoints: [],
	connection: null,
	knobSteps: 0,
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
	const lastKeepAliveSeq =
		event.kind === "keepalive"
			? event.seq
			: event.kind === "status" && event.state !== "connected"
				? null
				: previous.lastKeepAliveSeq;
	return {
		events,
		eventsReceived: previous.eventsReceived + 1,
		rotations: previous.rotations + (event.kind === "rotate" ? 1 : 0),
		presses:
			previous.presses + (event.kind === "press" && event.state !== 0 ? 1 : 0),
		lastKeepAliveSeq,
		touchPoints,
	};
}

export function appendLinkEvent(
	previous: DeviceLinkState,
	event: QuakeEvent,
): DeviceLinkState {
	return {
		connection: event.kind === "status" ? event : previous.connection,
		knobSteps:
			previous.knobSteps + (event.kind === "rotate" ? event.direction : 0),
	};
}

export function useQuakeEvents(): QuakeEventsView {
	const [state, setState] = useState<QuakeEventsView>(initialQuakeEvents);
	useEffect(() => {
		return window.openQuake?.onQuakeEvent((event) => {
			setState((previous) => ({
				...appendQuakeEvent(previous, event),
				...appendLinkEvent(previous, event),
			}));
		});
	}, []);
	return state;
}
