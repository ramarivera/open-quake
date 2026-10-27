import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
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

vi.mock("electron", () => ({
	webContents: { fromFrame: (frame: { contents?: unknown }) => frame.contents },
}));
afterEach(() => vi.useRealTimers());
function registration() {
	vi.useFakeTimers();
	const session = Object.assign(new EventEmitter(), {
		setDevicePermissionHandler: vi.fn(),
	});
	const contents = Object.assign(new EventEmitter(), {
		isDestroyed: () => false,
	});
	const frame = {
		url: "http://localhost:3010/via",
		isDestroyed: () => false,
		detached: false,
		contents,
	};
	const resume = vi.fn(async () => {});
	const release = vi.fn<() => Promise<() => Promise<void>>>(async () => resume);
	const isPresent = vi.fn(async () => true);
	const dispose: () => Promise<void> = Reflect.apply(
		registerViaPermissions,
		undefined,
		[
			session,
			{
				origin: "http://localhost:3010",
				selectedSerial: () => "A",
				release,
				isPresent,
			},
		],
	);
	const select = (selectedFrame: typeof frame | null = frame) =>
		new Promise<string>((callback) =>
			session.emit(
				"select-hid-device",
				{ preventDefault: vi.fn() },
				{ frame: selectedFrame, deviceList: [d] },
				callback,
			),
		);
	const permitted = () => {
		const handler = session.setDevicePermissionHandler.mock.calls[0]?.[0];
		if (typeof handler !== "function")
			throw new Error("Missing actual permission consumer");
		return handler({
			deviceType: "hid",
			origin: "http://localhost:3010",
			device: d,
		});
	};
	return {
		session,
		contents,
		frame,
		resume,
		release,
		isPresent,
		dispose,
		select,
		permitted,
	};
}
it("MAIN-107 Electron registration denies null frames, ignores unrelated removals and cleans listeners", async () => {
	const f = registration();
	expect(await f.select(null)).toBe("");
	expect(f.release).not.toHaveBeenCalled();
	expect(await f.select()).toBe("quake");
	expect(f.permitted()).toBe(true);
	f.session.emit(
		"hid-device-removed",
		{},
		{ device: { ...d, deviceId: "other" } },
	);
	await Promise.resolve();
	expect(f.resume).not.toHaveBeenCalled();
	f.session.emit("hid-device-removed", {}, { device: d });
	await Promise.resolve();
	expect(f.resume).toHaveBeenCalledTimes(1);
	expect(f.permitted()).toBe(false);
	await f.dispose();
	for (const name of [
		"select-hid-device",
		"hid-device-removed",
		"hid-device-revoked",
	])
		expect(f.session.listenerCount(name)).toBe(0);
	for (const name of [
		"did-start-navigation",
		"destroyed",
		"render-process-gone",
	])
		expect(f.contents.listenerCount(name)).toBe(0);
	expect(f.session.setDevicePermissionHandler).toHaveBeenLastCalledWith(null);
});
it("established VIA unplug resumes native reconnect without a chooser removal event and permits reselection", async () => {
	const f = registration();
	expect(await f.select()).toBe("quake");
	f.isPresent.mockResolvedValue(false);
	await vi.advanceTimersByTimeAsync(500);
	expect(f.resume).toHaveBeenCalledTimes(1);
	expect(f.permitted()).toBe(false);
	f.isPresent.mockResolvedValue(true);
	expect(await f.select()).toBe("quake");
	expect(f.permitted()).toBe(true);
	await f.dispose();
	expect(f.resume).toHaveBeenCalledTimes(2);
});
for (const ended of [
	"revoked",
	"navigate",
	"destroyed",
	"crash",
	"detached",
] as const) {
	it(`established VIA ${ended} denies the grant and resumes its bus exactly once`, async () => {
		const f = registration();
		expect(await f.select()).toBe("quake");
		if (ended === "revoked") {
			f.session.emit(
				"hid-device-revoked",
				{},
				{ device: d, origin: "http://unrelated:3010" },
			);
			expect(f.resume).not.toHaveBeenCalled();
			f.session.emit(
				"hid-device-revoked",
				{},
				{ device: d, origin: "http://localhost:3010" },
			);
		} else if (ended === "navigate") {
			f.contents.emit("did-start-navigation", {
				isSameDocument: true,
				isMainFrame: true,
				frame: f.frame,
			});
			f.contents.emit("did-start-navigation", {
				isSameDocument: false,
				isMainFrame: false,
				frame: {},
			});
			expect(f.permitted()).toBe(true);
			f.contents.emit("did-start-navigation", {
				isSameDocument: false,
				isMainFrame: true,
				frame: f.frame,
			});
		} else if (ended === "detached") {
			f.frame.detached = true;
			expect(f.permitted()).toBe(false);
			await vi.advanceTimersByTimeAsync(500);
		} else
			f.contents.emit(ended === "crash" ? "render-process-gone" : "destroyed");
		await Promise.resolve();
		expect(f.permitted()).toBe(false);
		expect(f.resume).toHaveBeenCalledTimes(1);
		await f.dispose();
		expect(f.resume).toHaveBeenCalledTimes(1);
	});
}
it("navigation during pending handoff cancels the grant and awaits native resume", async () => {
	const f = registration();
	let finish: ((resume: () => Promise<void>) => void) | undefined;
	f.release.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const selecting = f.select();
	f.contents.emit("did-start-navigation", {
		isSameDocument: false,
		isMainFrame: true,
		frame: f.frame,
	});
	finish?.(f.resume);
	expect(await selecting).toBe("");
	expect(f.permitted()).toBe(false);
	expect(f.resume).toHaveBeenCalledTimes(1);
	await f.dispose();
});
