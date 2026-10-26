import { Schema } from "effect";
import {
	HardwarePreferences,
	HardwareSnapshot,
	InputMode,
} from "../../../../packages/device/src/hardware/hardware-contracts";

export { HardwareSnapshot } from "../../../../packages/device/src/hardware/hardware-contracts";
export {
	luminancePercent,
	sliderToVolume,
	volumeToSlider,
} from "../../../../packages/device/src/hardware/hardware-invariants";
export const HARDWARE_REQUEST = "hardware:request";
const identity = { session: Schema.NonEmptyString };
export const HardwareRequest = Schema.Union(
	Schema.TaggedStruct("read", {}),
	Schema.TaggedStruct("configure", {
		...identity,
		preferences: HardwarePreferences,
	}),
	Schema.TaggedStruct("inputMode", { ...identity, mode: InputMode }),
	Schema.TaggedStruct("refresh", identity),
	Schema.TaggedStruct("toggleMic", identity),
	Schema.TaggedStruct("stepBrightness", {
		...identity,
		direction: Schema.Literal(-1, 1),
	}),
);
export type HardwareRequest = typeof HardwareRequest.Type;
export const HardwareResponse = Schema.Union(
	Schema.TaggedStruct("ready", {
		snapshot: HardwareSnapshot,
		mock: Schema.Boolean,
	}),
	Schema.TaggedStruct("offline", {}),
	Schema.TaggedStruct("failure", { code: Schema.String }),
);
export type HardwareResponse = typeof HardwareResponse.Type;
export interface HardwareBridge {
	readonly request: (input: HardwareRequest) => Promise<unknown>;
}
declare global {
	interface Window {
		readonly quakeHardware?: HardwareBridge;
	}
}

export const DEVICE_READY = "quake:device-ready";
export const DeviceReadySnapshot = Schema.Struct({
	serialNumber: Schema.NonEmptyString,
	connected: Schema.Boolean,
	deviceModel: Schema.Literal("QUAKE_HID"),
	connectionType: Schema.Literal("HID", "mock"),
	session: Schema.optional(Schema.String),
	version: Schema.optional(Schema.String),
	rotation: Schema.optional(Schema.Literal(0, 90, 180, 270)),
	keyMatrix: Schema.Struct({
		row: Schema.Literal(1, 2),
		col: Schema.Literal(8),
	}),
});
export type DeviceReadySnapshot = typeof DeviceReadySnapshot.Type;
export const DeviceReadyReply = Schema.Union(
	Schema.TaggedStruct("ready", { snapshot: DeviceReadySnapshot }),
	Schema.TaggedStruct("offline", {}),
	Schema.TaggedStruct("failure", { code: Schema.String }),
);
export type DeviceReadyReply = typeof DeviceReadyReply.Type;
export interface DeviceReadyBridge {
	read(serial?: string): Promise<unknown>;
}
declare global {
	interface Window {
		readonly quakeDeviceReady?: DeviceReadyBridge;
	}
}
export function negotiateDeviceMatrix(
	row: number,
	_col: number,
): DeviceReadySnapshot["keyMatrix"] | undefined {
	return row === 1 || row === 2 ? { row, col: 8 } : undefined;
}
