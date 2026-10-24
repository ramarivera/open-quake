import type { DeviceStatusEvent, QuakeEvent } from "../../../preload/quake";

export type ConnectionTone =
	| "connected"
	| "simulated"
	| "checking"
	| "offline"
	| "error"
	| "unavailable";

export type ConnectionSummary = {
	readonly tone: ConnectionTone;
	/** One or two words for the sidebar and status rows. */
	readonly label: string;
	readonly headline: string;
	readonly detail: string;
	/** Transport that produced the report, when one has arrived. */
	readonly link: string | null;
	/** Catalog code, shown for support; never a native message. */
	readonly code: string | null;
};

const RETRYING = "open-quake keeps retrying in the background.";

function describeError(
	status: Extract<DeviceStatusEvent, { state: "error" }>,
): Pick<ConnectionSummary, "tone" | "label" | "headline" | "detail"> {
	switch (status.error.code) {
		case "QUAKE.DEVICE.NOT_FOUND":
			return {
				tone: "offline",
				label: "Not connected",
				headline: "No QUAKE found",
				detail: `Plug your QUAKE in over USB. ${RETRYING}`,
			};
		case "QUAKE.HID.OPEN_FAILED":
			return {
				tone: "error",
				label: "Can't open",
				headline: "The QUAKE is busy",
				detail: `Another app may be holding it. Quit DK-Suite if it's running. ${RETRYING}`,
			};
		case "QUAKE.HID.DISCOVERY_FAILED":
			return {
				tone: "error",
				label: "Scan failed",
				headline: "Couldn't scan for USB devices",
				detail: RETRYING,
			};
		case "QUAKE.HID.READ_FAILED":
		case "QUAKE.HID.WRITE_FAILED":
			return {
				tone: "error",
				label: "Link error",
				headline: "Lost contact with the QUAKE",
				detail: `Check the USB cable. ${RETRYING}`,
			};
		default:
			return {
				tone: "error",
				label: "Error",
				headline: "The device connection failed",
				detail: RETRYING,
			};
	}
}

function describeDisconnect(
	reason: Extract<DeviceStatusEvent, { state: "disconnected" }>["reason"],
): string {
	switch (reason) {
		case "transport-ended":
			return `The USB connection ended. ${RETRYING}`;
		case "error":
			return `The connection dropped after an error. ${RETRYING}`;
		case "requested":
		case "scope-closed":
			return "The connection was closed by open-quake.";
	}
}

export function describeConnection(
	status: DeviceStatusEvent | null,
	bridgeAvailable: boolean,
): ConnectionSummary {
	if (!bridgeAvailable) {
		return {
			tone: "unavailable",
			label: "Unavailable",
			headline: "Device service unavailable",
			detail: "This page isn't running inside the open-quake app.",
			link: null,
			code: null,
		};
	}
	if (!status) {
		return {
			tone: "checking",
			label: "Checking…",
			headline: "Looking for your QUAKE",
			detail: "Waiting for the first report from the device service.",
			link: null,
			code: null,
		};
	}
	const link =
		status.source === "mock" ? "Mock device bus (development)" : "USB HID";
	switch (status.state) {
		case "connected":
			return status.source === "mock"
				? {
						tone: "simulated",
						label: "Simulated",
						headline: "Simulated QUAKE",
						detail:
							"Development mode. Input below comes from the mock device, not hardware.",
						link,
						code: null,
					}
				: {
						tone: "connected",
						label: "Connected",
						headline: "QUAKE connected",
						detail: "Turn or press the knob to see input arrive.",
						link,
						code: null,
					};
		case "disconnected":
			return {
				tone: "offline",
				label: "Disconnected",
				headline: "QUAKE disconnected",
				detail: describeDisconnect(status.reason),
				link,
				code: null,
			};
		case "error":
			return { ...describeError(status), link, code: status.error.code };
	}
}

/** Human text for the activity list. Heartbeats are summarized elsewhere. */
export function describeEvent(event: QuakeEvent): string | null {
	switch (event.kind) {
		case "rotate":
			return event.direction === 1
				? "Knob turned clockwise"
				: "Knob turned counterclockwise";
		case "press":
			return event.state === 0 ? "Knob released" : "Knob pressed";
		case "touch": {
			const first = event.points[0];
			return first
				? `Touch at ${first.x}, ${first.y}${event.points.length > 1 ? ` (+${event.points.length - 1})` : ""}`
				: "Touch ended";
		}
		case "status":
			return event.state === "connected"
				? event.source === "mock"
					? "Simulated device connected"
					: "Connected"
				: event.state === "disconnected"
					? "Disconnected"
					: `Connection error · ${event.error.code}`;
		case "keepalive":
			return null;
	}
}

export type ActivityEntry = { readonly ordinal: number; readonly text: string };

/** Newest first. Ordinals stay stable as the bounded log rolls over. */
export function recentActivity(
	events: readonly QuakeEvent[],
	eventsReceived: number,
	limit: number,
): ActivityEntry[] {
	const entries: ActivityEntry[] = [];
	for (
		let index = events.length - 1;
		index >= 0 && entries.length < limit;
		index -= 1
	) {
		const event = events[index];
		const text = event ? describeEvent(event) : null;
		if (text)
			entries.push({
				ordinal: eventsReceived - (events.length - 1 - index),
				text,
			});
	}
	return entries;
}
