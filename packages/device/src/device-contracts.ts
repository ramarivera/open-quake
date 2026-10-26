import {
	HardwareReply,
	isQuakeInterface,
	JsonValue,
	KeyMatrix,
	ResourceEnvelope,
} from "@open-quake/protocol";
import { Schema } from "effect";

export { QUAKE_IDENTITY } from "@open-quake/protocol";
export const DEFAULT_KEEP_ALIVE_MS = 15_000;

/** Native serial normalization is separate from imported socket alias decoding. */
export const canonicalHidSerial = (serial: string): string =>
	serial.replaceAll(":", "");
export const hidSerialFromAlias = (serial: string): string =>
	canonicalHidSerial(serial.startsWith("ws_") ? serial.slice(3) : serial);
export const wsSerialFromHid = (serial: string): string =>
	`ws_${canonicalHidSerial(serial)}`;
export const QUAKE_DEVICE_MODEL = "QUAKE_HID";

export const HidDeviceInfo = Schema.Struct({
	path: Schema.String,
	serialNumber: Schema.optional(Schema.String),
	vendorId: Schema.Number,
	productId: Schema.Number,
	usagePage: Schema.Number,
	usage: Schema.Number,
});
export type HidDeviceInfo = typeof HidDeviceInfo.Type;

export const TouchPoint = Schema.Struct({
	touchId: Schema.optionalWith(Schema.String, { exact: true }),
	action: Schema.Number,
	x: Schema.Number,
	y: Schema.Number,
});
export const DeviceEvent = Schema.Union(
	Schema.TaggedStruct("Json", { value: JsonValue }),
	Schema.TaggedStruct("Resource", { envelope: ResourceEnvelope }),
	Schema.TaggedStruct("Matrix", { matrix: KeyMatrix }),
	Schema.TaggedStruct("HardwareReply", { reply: HardwareReply }),
	Schema.TaggedStruct("KnobRotate", { delta: Schema.Literal(-1, 1) }),
	Schema.TaggedStruct("KnobPress", { state: Schema.Number }),
	Schema.TaggedStruct("Touch", { points: Schema.Array(TouchPoint) }),
	Schema.TaggedStruct("KeepAlive", {}),
	Schema.TaggedStruct("Disconnect", {
		reason: Schema.Literal(
			"requested",
			"transport-ended",
			"error",
			"scope-closed",
		),
	}),
);
export type DeviceEvent = typeof DeviceEvent.Type;

export interface ConnectOptions {
	readonly keepAliveIntervalMs?: number;
	readonly path?: string;
}

export const isQuakeDevice = (info: HidDeviceInfo): boolean =>
	isQuakeInterface(info);
