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

it("SETTINGS-015 requests only a denied user-selected permission, refreshes status and skips a newly granted microphone deep link", async () => {
	const { Effect } = await import("effect");
	const { permissionAction } = await import("./permissions");
	let microphone = false;
	const checks = {
		accessibility: () => true,
		inputMonitoring: () => false,
		microphone: () => microphone,
		screenRecording: () => "unsupported",
		systemAudio: () => undefined,
	};
	const request = vi.fn(async () => {
		microphone = true;
	});
	const open = vi.fn(async () => {});
	expect(
		permissionRows(checks).find((row) => row.key === "screenRecording")?.status,
	).toBe("unsupported");
	expect(request).not.toHaveBeenCalled();
	await Effect.runPromise(
		permissionAction("microphone", { checks, request, open }),
	);
	expect(request).toHaveBeenCalledExactlyOnceWith("microphone");
	expect(open).not.toHaveBeenCalled();
	await Effect.runPromise(
		permissionAction("accessibility", { checks, request, open }),
	);
	expect(request).toHaveBeenCalledOnce();
	expect(open).toHaveBeenCalledExactlyOnceWith("accessibility");
	await Effect.runPromise(
		permissionAction("microphone", { checks, request, open }),
	);
	expect(request).toHaveBeenCalledOnce();
	expect(open).toHaveBeenLastCalledWith("microphone");
});
it("SETTINGS-015 retains denied/unknown probes and typed scrubbed errors after a rejected request", async () => {
	const { Effect } = await import("effect");
	const { permissionAction } = await import("./permissions");
	const checks = {
		accessibility: () => false,
		inputMonitoring: () => false,
		microphone: () => false,
		screenRecording: () => undefined,
		systemAudio: () => undefined,
	};
	const original = new Error("private request cause");
	const open = vi.fn(async () => {});
	const result = await Effect.runPromise(
		Effect.either(
			permissionAction("inputMonitoring", {
				checks,
				request: async () => {
					throw original;
				},
				open,
			}),
		),
	);
	expect(result._tag).toBe("Left");
	if (result._tag === "Left") {
		expect(result.left.code).toBe("QUAKE.SETTINGS.PERMISSION_PROBE_FAILED");
		expect(result.left.originalCause).toBe(original);
		expect(JSON.stringify(result.left)).not.toContain("private request cause");
	}
	expect(open).not.toHaveBeenCalled();
	expect(permissionRows(checks)[1]?.status).toBe("denied");
});
