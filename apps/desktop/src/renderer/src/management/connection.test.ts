import { describe, expect, it } from "vitest";
import type {
	DeviceStatusError,
	DeviceStatusEvent,
	QuakeEvent,
} from "../../../preload/quake";
import {
	describeConnection,
	describeEvent,
	recentActivity,
} from "./connection";

function failure(error: DeviceStatusError): DeviceStatusEvent {
	return { source: "hid", kind: "status", state: "error", error };
}

const notFound = failure({
	_tag: "QuakeDeviceNotFound",
	code: "QUAKE.DEVICE.NOT_FOUND",
	category: "unavailable",
});
const openFailed = failure({
	_tag: "QuakeHidOpenFailed",
	code: "QUAKE.HID.OPEN_FAILED",
	category: "dependency",
});
// No dedicated copy: exercises the generic fallback.
const closeFailed = failure({
	_tag: "QuakeHidCloseFailed",
	code: "QUAKE.HID.CLOSE_FAILED",
	category: "dependency",
});

describe("connection summary", () => {
	it("reports a missing bridge before anything else", () => {
		const summary = describeConnection(
			{ source: "hid", kind: "status", state: "connected" },
			false,
		);
		expect(summary.tone).toBe("unavailable");
		expect(summary.link).toBeNull();
	});

	it("waits for the first report instead of guessing", () => {
		const summary = describeConnection(null, true);
		expect(summary.tone).toBe("checking");
		expect(summary.link).toBeNull();
		expect(summary.code).toBeNull();
	});

	it("tells real hardware apart from the mock device", () => {
		const hid = describeConnection(
			{ source: "hid", kind: "status", state: "connected" },
			true,
		);
		const mock = describeConnection(
			{ source: "mock", kind: "status", state: "connected" },
			true,
		);
		expect(hid).toMatchObject({
			tone: "connected",
			label: "Connected",
			link: "USB HID",
		});
		expect(mock).toMatchObject({
			tone: "simulated",
			label: "Simulated",
			link: "Mock device bus (development)",
		});
	});

	it("explains disconnects by reason", () => {
		const ended = describeConnection(
			{
				source: "hid",
				kind: "status",
				state: "disconnected",
				reason: "transport-ended",
			},
			true,
		);
		const requested = describeConnection(
			{
				source: "hid",
				kind: "status",
				state: "disconnected",
				reason: "requested",
			},
			true,
		);
		expect(ended.tone).toBe("offline");
		expect(ended.detail).toContain("retrying");
		expect(requested.detail).not.toContain("retrying");
	});

	it("maps catalog codes to human copy and keeps the code for support", () => {
		const missing = describeConnection(notFound, true);
		const busy = describeConnection(openFailed, true);
		const generic = describeConnection(closeFailed, true);
		expect(missing).toMatchObject({
			tone: "offline",
			headline: "No QUAKE found",
			code: "QUAKE.DEVICE.NOT_FOUND",
		});
		expect(busy).toMatchObject({
			tone: "error",
			code: "QUAKE.HID.OPEN_FAILED",
		});
		expect(busy.detail).toContain("DK-Suite");
		expect(generic).toMatchObject({
			tone: "error",
			headline: "The device connection failed",
			code: "QUAKE.HID.CLOSE_FAILED",
		});
	});
});

describe("activity log", () => {
	it("leaves heartbeats out of the readable log", () => {
		expect(describeEvent({ source: "hid", kind: "keepalive", seq: 3 })).toBe(
			null,
		);
		expect(
			describeEvent({ source: "hid", kind: "rotate", direction: -1 }),
		).toBe("Knob turned counterclockwise");
		expect(
			describeEvent({
				source: "hid",
				kind: "touch",
				points: [
					{ action: 0, x: 10, y: 20 },
					{ action: 0, x: 30, y: 40 },
				],
			}),
		).toBe("Touch at 10, 20 (+1)");
	});

	it("lists newest first with ordinals that survive log rollover", () => {
		const events: QuakeEvent[] = [
			{ source: "hid", kind: "rotate", direction: 1 },
			{ source: "hid", kind: "keepalive", seq: 1 },
			{ source: "hid", kind: "press", state: 1 },
			{ source: "hid", kind: "press", state: 0 },
		];
		// 10 events arrived in total; only the last four are still retained.
		expect(recentActivity(events, 10, 2)).toEqual([
			{ ordinal: 10, text: "Knob released" },
			{ ordinal: 9, text: "Knob pressed" },
		]);
		expect(recentActivity(events, 10, 5)).toEqual([
			{ ordinal: 10, text: "Knob released" },
			{ ordinal: 9, text: "Knob pressed" },
			{ ordinal: 7, text: "Knob turned clockwise" },
		]);
	});
});
