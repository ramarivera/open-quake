import { Schema } from "effect";
import {
	HardwarePreferences,
	HardwareSnapshot,
	InputMode,
} from "../../../../packages/device/src/hardware/hardware-contracts";
import { QmkOperation } from "../../../../packages/device/src/hardware/qmk-operations";
import {
	LightingChange,
	LightingFieldCapability,
} from "../../../../packages/device/src/lighting/lighting-contracts";

export { HardwareSnapshot } from "../../../../packages/device/src/hardware/hardware-contracts";
export {
	luminancePercent,
	sliderToVolume,
	volumeToSlider,
} from "../../../../packages/device/src/hardware/hardware-invariants";
export const HARDWARE_REQUEST = "hardware:request";
export const QmkBinding = Schema.Struct({
	name: Schema.String,
	prefix: Schema.Array(Schema.Uint8),
	before: Schema.Array(Schema.Uint8),
	after: Schema.Array(Schema.Uint8),
	changed: Schema.Boolean,
});
const identity = { session: Schema.NonEmptyString };
export const HardwareRequest = Schema.Union(
	Schema.TaggedStruct("chooseGameTarget", {
		kind: Schema.Literal("file", "folder", "application"),
	}),
	Schema.TaggedStruct("qmkTargets", {}),
	Schema.TaggedStruct("qmkBindings", {
		...identity,
		serial: Schema.NonEmptyString,
	}),
	Schema.TaggedStruct("lighting", {
		...identity,
		serial: Schema.NonEmptyString,
		action: Schema.Union(
			Schema.TaggedStruct("select", {}),
			Schema.TaggedStruct("save", {}),
			Schema.TaggedStruct("set", { change: LightingChange }),
		),
	}),
	Schema.TaggedStruct("qmk", {
		...identity,
		serial: Schema.NonEmptyString,
		operations: Schema.Array(QmkOperation).pipe(
			Schema.minItems(1),
			Schema.maxItems(64),
		),
	}),
	Schema.TaggedStruct("read", {
		serial: Schema.optional(Schema.NonEmptyString),
	}),
	Schema.TaggedStruct("configure", {
		...identity,
		preferences: HardwarePreferences,
	}),
	Schema.TaggedStruct("inputMode", { ...identity, mode: InputMode }),
	Schema.TaggedStruct("refresh", identity),
	Schema.TaggedStruct("toggleMic", identity),
	Schema.TaggedStruct("longTone", { ...identity, on: Schema.Boolean }),
	Schema.TaggedStruct("stepBrightness", {
		...identity,
		direction: Schema.Literal(-1, 1),
	}),
);
export type HardwareRequest = typeof HardwareRequest.Type;
export const HardwareResponse = Schema.Union(
	Schema.TaggedStruct("gameTarget", { path: Schema.String }),
	Schema.TaggedStruct("cancelled", {}),
	Schema.TaggedStruct("lighting", {
		session: Schema.String,
		status: Schema.Literal("ready", "reading", "unavailable"),
		fields: Schema.Array(LightingFieldCapability),
		values: Schema.Array(LightingChange),
		saveStatus: Schema.Literal("unknown", "unsaved", "saved", "failed"),
		canSave: Schema.Boolean,
	}),
	Schema.TaggedStruct("qmkTargets", {
		targets: Schema.Array(
			Schema.Struct({ serial: Schema.String, session: Schema.String }),
		),
	}),
	Schema.TaggedStruct("qmkBindings", { bindings: Schema.Array(QmkBinding) }),
	Schema.TaggedStruct("qmk", {
		values: Schema.Array(Schema.Array(Schema.Uint8)),
	}),
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
