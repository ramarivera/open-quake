import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import {
	registerViaPermissions,
	selectViaDevice,
	viaPermissionBroker,
} from "./via-permissions";

const d = {
	deviceId: "quake",
	serialNumber: "A",
	vendorId: 0x4158,
	productId: 0x514b,
	collections: [{ usagePage: 0xff60, usage: 0x61 }],
};
it("MAIN-107 canonical serial matching retains colon-form Chromium identity and rejects aliases shared by two devices", () => {
	const device = { ...d, serialNumber: " AA:BB " };
	expect(
		selectViaDevice("http://localhost:3010", "http://localhost:3010", "AABB", [
			device,
		]),
	).toBe(device);
	expect(
		selectViaDevice("http://localhost:3010", "http://localhost:3010", "AABB", [
			device,
			{ ...device, deviceId: "duplicate", serialNumber: "AABB" },
		]),
	).toBeUndefined();
	expect(
		selectViaDevice("http://localhost:3010", "http://localhost:3010", " : ", [
			{ ...device, serialNumber: " : " },
		]),
	).toBeUndefined();
});
it("MAIN-107 disposal waits for an in-flight release and resumes it without granting permission", async () => {
	let finish: ((resume: () => Promise<void>) => void) | undefined;
	const release = new Promise<() => Promise<void>>((r) => {
		finish = r;
	});
	const resume = vi.fn(async () => {});
	const broker = viaPermissionBroker({
		origin: "http://localhost:3010",
		selectedSerial: () => "A",
		release: () => release,
	});
	const selecting = broker.select("http://localhost:3010", [d]);
	let disposed = false;
	const disposal = broker.dispose().then(() => {
		disposed = true;
	});
	await Promise.resolve();
	expect(disposed).toBe(false);
	finish?.(resume);
	expect(await selecting).toBe("");
	await disposal;
	expect(resume).toHaveBeenCalledTimes(1);
	expect(broker.permitted("http://localhost:3010", d)).toBe(false);
	expect(await broker.select("http://localhost:3010", [d])).toBe("");
});
it("MAIN-107 Electron registration denies null frames and unrelated removals retain the lease", async () => {
	const session = Object.assign(new EventEmitter(), {
		setDevicePermissionHandler: vi.fn(),
	});
	const resume = vi.fn(async () => {});
	const release = vi.fn(async () => resume);
	const dispose: () => Promise<void> = Reflect.apply(
		registerViaPermissions,
		undefined,
		[
			session,
			{ origin: "http://localhost:3010", selectedSerial: () => "A", release },
		],
	);
	const preventDefault = vi.fn();
	const select = (frame: { url: string } | null) =>
		new Promise<string>((callback) =>
			session.emit(
				"select-hid-device",
				{ preventDefault },
				{ frame, deviceList: [d] },
				callback,
			),
		);
	expect(await select(null)).toBe("");
	expect(release).not.toHaveBeenCalled();
	expect(await select({ url: "http://localhost:3010/via" })).toBe("quake");
	session.emit(
		"hid-device-removed",
		{},
		{ device: { ...d, deviceId: "other" } },
	);
	await Promise.resolve();
	expect(resume).not.toHaveBeenCalled();
	session.emit("hid-device-removed", {}, { device: d });
	await Promise.resolve();
	expect(resume).toHaveBeenCalledTimes(1);
	await dispose();
	expect(session.listenerCount("select-hid-device")).toBe(0);
	expect(session.listenerCount("hid-device-removed")).toBe(0);
	expect(session.setDevicePermissionHandler).toHaveBeenLastCalledWith(null);
});
