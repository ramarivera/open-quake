import { Schema } from "effect";

export const QUAKE_IDENTITY = {
	vendorId: 0x4158,
	productId: 0x514b,
	usagePage: 0xff60,
	usage: 0x61,
} as const;
export const DEFAULT_KEEP_ALIVE_MS = 15_000;

export const HidDeviceInfo = Schema.Struct({
	path: Schema.String,
	vendorId: Schema.Number,
	productId: Schema.Number,
	usagePage: Schema.Number,
	usage: Schema.Number,
});
export type HidDeviceInfo = typeof HidDeviceInfo.Type;

export const TouchPoint = Schema.Struct({
	action: Schema.Number,
	x: Schema.Number,
	y: Schema.Number,
});
export const DeviceEvent = Schema.Union(
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
}

export const isQuakeDevice = (info: HidDeviceInfo): boolean =>
	info.vendorId === QUAKE_IDENTITY.vendorId &&
	info.productId === QUAKE_IDENTITY.productId &&
	info.usagePage === QUAKE_IDENTITY.usagePage &&
	info.usage === QUAKE_IDENTITY.usage;
