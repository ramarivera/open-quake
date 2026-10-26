import { expect, it, vi } from "vitest";
import {
	startTestParentGuard,
	validateDeviceTestPolicy,
} from "./device-test-policy";

it("rejects packaged fixtures and weakened firmware limits before startup", () => {
	expect(() =>
		validateDeviceTestPolicy(true, { OPEN_QUAKE_FAKE_HID_DEVICES: "[]" }),
	).toThrow("packaged");
	expect(() =>
		validateDeviceTestPolicy(false, { OPEN_QUAKE_FW_LIMITS: "1" }),
	).toThrow("safety limits");
	expect(() =>
		validateDeviceTestPolicy(true, { OPEN_QUAKE_MOCK_DEVICE: "1" }),
	).not.toThrow();
});
it("owns a test-only parent-loss timer and releases it", () => {
	let parent = 42;
	let check = () => {};
	const quit = vi.fn();
	const cancel = vi.fn();
	const stop = startTestParentGuard({
		enabled: true,
		parent: () => parent,
		quit,
		schedule: (fn, ms) => {
			check = fn;
			expect(ms).toBe(1000);
			return cancel;
		},
	});
	check();
	expect(quit).not.toHaveBeenCalled();
	parent = 1;
	check();
	expect(quit).toHaveBeenCalledOnce();
	stop();
	expect(cancel).toHaveBeenCalledOnce();
	startTestParentGuard({
		enabled: false,
		parent: () => {
			throw Error("disabled");
		},
		quit,
		schedule: () => {
			throw Error("disabled");
		},
	})();
});
