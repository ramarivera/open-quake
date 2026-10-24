import type {
	DeviceConnectError,
	DeviceEvent,
	DeviceStreamError,
} from "@open-quake/device";

/** Only catalog identity crosses IPC. Diagnostics and native causes stay in main. */
export type DeviceStatusError = Pick<
	DeviceConnectError | DeviceStreamError,
	"_tag" | "code" | "category"
>;
export type DeviceStatusEvent = { source: "mock" | "hid"; kind: "status" } & (
	| { state: "connected" }
	| {
			state: "disconnected";
			reason: Extract<DeviceEvent, { _tag: "Disconnect" }>["reason"];
	  }
	| { state: "error"; error: DeviceStatusError }
);

/** Shared IPC contract. Safe to import as a type from renderer code. */
export type QuakeEvent =
	| DeviceStatusEvent
	| { source: "mock" | "hid"; kind: "rotate"; direction: 1 | -1 }
	| { source: "mock" | "hid"; kind: "press"; state?: number }
	| {
			source: "mock" | "hid";
			kind: "touch";
			points: ReadonlyArray<{
				touchId?: string;
				action: number;
				x: number;
				y: number;
			}>;
	  }
	| { source: "mock" | "hid"; kind: "keepalive"; seq: number };

export const QUAKE_EVENT_CHANNEL = "quake:event";
export const QUAKE_STATUS_CHANNEL = "quake:status";

export type OpenQuakeBridge = {
	readonly version: string;
	onQuakeEvent(callback: (event: QuakeEvent) => void): () => void;
};
