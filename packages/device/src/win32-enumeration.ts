import type { HidDeviceInfo } from "./device-contracts.js";
import { QUAKE_IDENTITY } from "./device-contracts.js";

/** Read-only Windows control-interface discovery. Loads no DLL on other hosts. */
export async function enumerateWin32(): Promise<readonly HidDeviceInfo[]> {
	const { default: ffi } = await import("koffi");
	const cfg = ffi.load("cfgmgr32.dll");
	const hid = ffi.load("hid.dll");
	const kernel = ffi.load("kernel32.dll");
	const guid = Buffer.from("b2551e4d6ff1cf1188cb001111000030", "hex");
	const getSize = cfg.func(
		"uint32_t __stdcall CM_Get_Device_Interface_List_SizeW(_Out_ uint32_t *len, void *guid, void *id, uint32_t flags)",
	);
	const getList = cfg.func(
		"uint32_t __stdcall CM_Get_Device_Interface_ListW(void *guid, void *id, void *list, uint32_t len, uint32_t flags)",
	);
	const open = kernel.func(
		"void * __stdcall CreateFileW(str16 path, uint32_t access, uint32_t share, void *security, uint32_t disposition, uint32_t flags, void *templateFile)",
	);
	const close = kernel.func("bool __stdcall CloseHandle(void *handle)");
	const serial = hid.func(
		"bool __stdcall HidD_GetSerialNumberString(void *handle, void *buffer, uint32_t size)",
	);
	const preparsed = hid.func(
		"bool __stdcall HidD_GetPreparsedData(void *handle, _Out_ void **data)",
	);
	const free = hid.func("bool __stdcall HidD_FreePreparsedData(void *data)");
	const caps = hid.func(
		"int32_t __stdcall HidP_GetCaps(void *data, void *caps)",
	);
	const size: number[] = [0];
	if (getSize(size, guid, null, 0) !== 0)
		throw new Error("Win32 interface size failed");
	const count = size[0] ?? 0;
	if (!Number.isInteger(count) || count < 0 || count > 4_000_000)
		throw new Error("Win32 interface list invalid");
	if (!count) return [];
	const list = Buffer.alloc(count * 2);
	if (getList(guid, null, list, count, 0) !== 0)
		throw new Error("Win32 interface list failed");
	const devices: HidDeviceInfo[] = [];
	for (const path of list.toString("utf16le").split("\0").filter(Boolean)) {
		const match = /vid_([\da-f]{4})&pid_([\da-f]{4})/i.exec(path);
		if (!match) continue;
		const vendorId = Number.parseInt(match[1] ?? "", 16);
		const productId = Number.parseInt(match[2] ?? "", 16);
		if (
			vendorId !== QUAKE_IDENTITY.vendorId ||
			productId !== QUAKE_IDENTITY.productId
		)
			continue;
		const handle: unknown = open(path, 0, 3, null, 3, 0, null);
		if (handle === null || handle === -1n)
			throw new Error("Win32 HID metadata open failed");
		try {
			const data: unknown[] = [null];
			if (!preparsed(handle, data))
				throw new Error("Win32 HID preparsed data failed");
			const buffer = Buffer.alloc(64);
			try {
				if (caps(data[0], buffer) !== 0x110000)
					throw new Error("Win32 HID capabilities failed");
			} finally {
				free(data[0]);
			}
			const sn = Buffer.alloc(512);
			const serialNumber = serial(handle, sn, sn.length)
				? sn.toString("utf16le").split("\0")[0]
				: undefined;
			devices.push({
				path,
				vendorId,
				productId,
				usage: buffer.readUInt16LE(0),
				usagePage: buffer.readUInt16LE(2),
				...(serialNumber ? { serialNumber } : {}),
			});
		} finally {
			close(handle);
		}
	}
	return devices;
}
