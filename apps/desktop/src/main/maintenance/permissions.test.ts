import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: {}, systemPreferences: {} }));

import { permissionLinks, permissionRows } from "./permissions";

describe("live permissions", () => {
	it("uses the five real preflights and never equates registration with grant", () => {
		const rows = permissionRows({
			accessibility: () => true,
			inputMonitoring: () => false,
			microphone: () => "denied",
			screenRecording: () => {
				throw new Error("missing");
			},
			systemAudio: () => undefined,
		});
		expect(rows.map((r) => r.status)).toEqual([
			"granted",
			"denied",
			"denied",
			"unknown",
			"unknown",
		]);
		expect(permissionLinks).toEqual({
			accessibility: "Accessibility",
			inputMonitoring: "ListenEvent",
			microphone: "Microphone",
			screenRecording: "ScreenCapture",
			systemAudio: "AudioCapture",
		});
	});
	it("re-probes live state on every read", () => {
		let granted = false;
		const checks = {
			accessibility: () => granted,
			inputMonitoring: () => false,
			microphone: () => false,
			screenRecording: () => false,
			systemAudio: () => false,
		};
		expect(permissionRows(checks)[0]?.status).toBe("denied");
		granted = true;
		expect(permissionRows(checks)[0]?.status).toBe("granted");
	});
});
