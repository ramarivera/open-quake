import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
	paths: [] as string[],
	close: vi.fn(),
	free: vi.fn(),
	failCaps: false,
}));
vi.mock("koffi", () => ({
	default: {
		address: () => 1n,
		load: () => ({
			func:
				(signature: string) =>
				(...args: unknown[]) => {
					if (signature.includes("List_SizeW")) {
						if (Array.isArray(args[0]))
							args[0][0] = native.paths.join("\0").length + 2;
						return 0;
					}
					if (signature.includes("Interface_ListW")) {
						if (Buffer.isBuffer(args[2]))
							args[2].write(`${native.paths.join("\0")}\0\0`, "utf16le");
						return 0;
					}
					if (signature.includes("CreateFileW")) return { path: args[0] };
					if (signature.includes("CloseHandle")) {
						native.close();
						return true;
					}
					if (signature.includes("GetPreparsedData")) {
						if (Array.isArray(args[1])) args[1][0] = {};
						return true;
					}
					if (signature.includes("FreePreparsedData")) {
						native.free();
						return true;
					}
					if (signature.includes("HidP_GetCaps")) {
						if (native.failCaps) return 0;
						if (Buffer.isBuffer(args[1])) {
							args[1].writeUInt16LE(0x61, 0);
							args[1].writeUInt16LE(0xff60, 2);
						}
						return 0x110000;
					}
					if (signature.includes("SerialNumberString")) {
						if (Buffer.isBuffer(args[1])) args[1].write("AB:CD\0", "utf16le");
						return true;
					}
					throw new Error(`Unexpected native function ${signature}`);
				},
		}),
	},
}));

import { enumerateWin32 } from "../src/win32-enumeration.js";

beforeEach(() => {
	vi.clearAllMocks();
	native.paths = [];
	native.failCaps = false;
});
it("MAIN-004 enumerates QUAKE and touch metadata, ignores unrelated devices and closes every probe", async () => {
	native.paths = [
		"hid#vid_4158&pid_514b#quake",
		"hid#vid_0712&pid_0010#touch",
		"hid#vid_ffff&pid_ffff#other",
	];
	const result = await enumerateWin32();
	expect(result).toMatchObject([
		{
			path: native.paths[0],
			serialNumber: "AB:CD",
			vendorId: 0x4158,
			productId: 0x514b,
			usagePage: 0xff60,
			usage: 0x61,
		},
		{ path: native.paths[1], vendorId: 0x0712, productId: 0x0010 },
	]);
	expect(native.close).toHaveBeenCalledTimes(2);
	expect(native.free).toHaveBeenCalledTimes(2);
});
it("MAIN-004 frees native probes before propagating an enumeration failure to fallback", async () => {
	native.paths = ["hid#vid_4158&pid_514b#quake"];
	native.failCaps = true;
	await expect(enumerateWin32()).rejects.toThrow("capabilities");
	expect(native.close).toHaveBeenCalledOnce();
	expect(native.free).toHaveBeenCalledOnce();
});
