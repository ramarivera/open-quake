import { Schema } from "effect";
import type { HidDeviceInfo } from "../device-contracts.js";

export const TOUCH_IDENTITY = {
	vendorId: 0x0712,
	productId: 0x0010,
	usagePage: 0xff73,
	usage: 0x71,
} as const;
export const TOUCH_IDLE_UP_MS = 100;
export const TOUCH_MATCH_DISTANCE = 99;
export const MAX_TOUCH_POINTS = 5;

export interface Point {
	readonly x: number;
	readonly y: number;
}
export interface RawTouchPoint extends Point {
	readonly action: number;
}
export interface TrackedTouchPoint extends Point {
	readonly action: 0 | 1;
	readonly touchId: string;
}
export const TouchState = Schema.Literal(
	"UNKNOWN",
	"TOUCH_OK",
	"HID_ENUM_EMPTY",
	"DK_TARGET_NOT_FOUND",
	"DK_TARGET_OPEN_FAILED",
	"HID_READ_FAILED",
	"RECOVERING",
);
export type TouchState = typeof TouchState.Type;
export interface TouchHealth {
	readonly state: TouchState;
	readonly reports: number;
	readonly frames: number;
	readonly bindAttempts: number;
	readonly recoveryCycle: number;
	readonly errorCode?: string;
}
export const isTouchDevice = (device: HidDeviceInfo): boolean =>
	device.vendorId === TOUCH_IDENTITY.vendorId &&
	device.productId === TOUCH_IDENTITY.productId &&
	device.usagePage === TOUCH_IDENTITY.usagePage &&
	device.usage === TOUCH_IDENTITY.usage &&
	device.path.length > 0;
