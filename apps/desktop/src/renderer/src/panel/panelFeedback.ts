import type { DeviceStatusEvent, QuakeEvent } from "../../../preload/quake";
import { PANEL_CANVAS } from "../../../shared/display";

/** One knob detent moves the on-screen pointer by this many degrees. */
export const DETENT_DEGREES = 15;
/** The knob instrument hides after this long without knob input. */
export const IDLE_AFTER_MS = 4000;
/** Mock presses carry no release report, so they show as a short pulse. */
export const PRESS_PULSE_MS = 240;
export const TOUCH_MARK_MS = 900;

export type TouchMark = {
	readonly id: string;
	readonly x: number;
	readonly y: number;
};

/** Timestamps are milliseconds on one caller-supplied clock. */
export type PanelFeedback = {
	readonly status: DeviceStatusEvent | null;
	readonly detents: number;
	readonly held: boolean;
	readonly pulseUntil: number;
	readonly activeUntil: number;
	readonly touchSerial: number;
	readonly touches: readonly TouchMark[];
	readonly touchesUntil: number;
};

export const initialPanelFeedback: PanelFeedback = {
	status: null,
	detents: 0,
	held: false,
	pulseUntil: 0,
	activeUntil: 0,
	touchSerial: 0,
	touches: [],
	touchesUntil: 0,
};

const insideCanvas = (point: { x: number; y: number }): boolean =>
	point.x >= 0 &&
	point.x <= PANEL_CANVAS.width &&
	point.y >= 0 &&
	point.y <= PANEL_CANVAS.height;

export function applyPanelEvent(
	state: PanelFeedback,
	event: QuakeEvent,
	now: number,
): PanelFeedback {
	switch (event.kind) {
		case "json":
		case "resource":
		case "matrix":
			return state;
		case "status":
			return {
				...state,
				status: event,
				// A release report cannot arrive after the link drops.
				held: event.state === "connected" && state.held,
			};
		case "rotate":
			return {
				...state,
				detents: state.detents + event.direction,
				activeUntil: now + IDLE_AFTER_MS,
			};
		case "press":
			// HID reports down (non-zero) and up (0); mock presses have no state.
			return event.state === undefined
				? {
						...state,
						pulseUntil: now + PRESS_PULSE_MS,
						activeUntil: now + IDLE_AFTER_MS,
					}
				: {
						...state,
						held: event.state !== 0,
						activeUntil: now + IDLE_AFTER_MS,
					};
		case "touch": {
			// Touch coordinates are hardware-unverified. Plot only points that
			// already fall inside the logical canvas; never guess a mapping.
			const touchSerial = state.touchSerial + 1;
			return {
				...state,
				touchSerial,
				touches: event.points.filter(insideCanvas).map((point, index) => ({
					id: `${touchSerial}-${index}`,
					x: point.x,
					y: point.y,
				})),
				touchesUntil: now + TOUCH_MARK_MS,
			};
		}
		case "keepalive":
			return state;
	}
}

/** The earliest future moment the view changes without a new event. */
export function nextPanelDeadline(
	state: PanelFeedback,
	now: number,
): number | null {
	const pending = [state.pulseUntil, state.activeUntil, state.touchesUntil]
		.filter((deadline) => deadline > now)
		.sort((a, b) => a - b);
	return pending[0] ?? null;
}

export type PanelLink =
	| { readonly state: "pending" }
	| { readonly state: "connected" }
	| {
			readonly state: "offline";
			readonly detail: string;
			readonly code: string | null;
	  };

export type PanelFeedbackView = {
	readonly link: PanelLink;
	readonly mock: boolean;
	readonly knobVisible: boolean;
	readonly detents: number;
	readonly pressed: boolean;
	readonly touches: readonly TouchMark[];
};

function linkOf(status: DeviceStatusEvent | null): PanelLink {
	if (!status) return { state: "pending" };
	switch (status.state) {
		case "connected":
			return { state: "connected" };
		// The desktop device bus retries after every disconnect and error.
		case "disconnected":
			return {
				state: "offline",
				detail: "Reconnecting to the QUAKE",
				code: null,
			};
		case "error":
			return {
				state: "offline",
				detail: "Retrying automatically",
				code: status.error.code,
			};
	}
}

export function viewPanelFeedback(
	state: PanelFeedback,
	now: number,
): PanelFeedbackView {
	const link = linkOf(state.status);
	return {
		link,
		mock: state.status?.source === "mock",
		knobVisible:
			link.state === "connected" && (state.held || now < state.activeUntil),
		detents: state.detents,
		pressed: state.held || now < state.pulseUntil,
		touches: now < state.touchesUntil ? state.touches : [],
	};
}

/** Signed detent count; negatives use U+2212 to match the plus sign width. */
export function formatDetents(detents: number): string {
	return detents > 0 ? `+${detents}` : detents < 0 ? `−${-detents}` : "0";
}
