import { closeSync, constants, openSync, writeSync } from "node:fs";
import koffi from "koffi";

/** USB HID usages to Linux input-event key codes, independent of the desktop session. */
const letterKeys = [
	30, 48, 46, 32, 18, 33, 34, 35, 23, 36, 37, 38, 50, 49, 24, 25, 16, 19, 31,
	20, 22, 47, 17, 45, 21, 44,
];
export const linuxKeyCode = (usage: number): number | undefined => {
	if (usage >= 4 && usage <= 29) return letterKeys[usage - 4];
	if (usage >= 30 && usage <= 38) return usage - 28;
	if (usage >= 58 && usage <= 67) return usage + 1;
	if (usage >= 104 && usage <= 115) return usage + 79;
	const other: Readonly<Record<number, number>> = {
		39: 11,
		40: 28,
		41: 1,
		42: 14,
		43: 15,
		44: 57,
		45: 12,
		46: 13,
		47: 26,
		48: 27,
		49: 43,
		50: 86,
		51: 39,
		52: 40,
		53: 41,
		54: 51,
		55: 52,
		56: 53,
		57: 58,
		68: 87,
		69: 88,
		70: 99,
		71: 70,
		72: 119,
		73: 110,
		74: 102,
		75: 104,
		76: 111,
		77: 107,
		78: 109,
		79: 106,
		80: 105,
		81: 108,
		82: 103,
		83: 69,
		84: 98,
		85: 55,
		86: 74,
		87: 78,
		88: 96,
		89: 79,
		90: 80,
		91: 81,
		92: 75,
		93: 76,
		94: 77,
		95: 71,
		96: 72,
		97: 73,
		98: 82,
		99: 83,
		100: 86,
		101: 127,
		224: 29,
		225: 42,
		226: 56,
		227: 125,
		228: 97,
		229: 54,
		230: 100,
		231: 126,
	};
	return other[usage];
};
export interface UinputDriver {
	open: () => number;
	ioctl: (fd: number, request: number, value: number | Buffer) => void;
	write: (fd: number, bytes: Buffer) => void;
	close: (fd: number) => void;
}
export function uinputDriver(): UinputDriver {
	const libc = koffi.load("libc.so.6");
	const ioctl = libc.func("int ioctl(int fd, unsigned long request, ...)");
	return {
		open: () =>
			openSync("/dev/uinput", constants.O_WRONLY | constants.O_NONBLOCK),
		ioctl: (fd, request, value) => {
			if (
				ioctl(
					fd,
					request,
					typeof value === "number" ? "int" : "void *",
					value,
				) < 0
			)
				throw new Error("uinput-ioctl-failed");
		},
		write: (fd, bytes) => {
			if (writeSync(fd, bytes) !== bytes.length)
				throw new Error("uinput-short-write");
		},
		close: closeSync,
	};
}
/** Only the existing /dev/uinput permissions are used. No sudo or permission mutation. */
export function linuxKeyboardPort(driver: UinputDriver = uinputDriver()) {
	let fd: number | undefined;
	const initialize = () => {
		if (fd !== undefined) return fd;
		const opened = driver.open();
		try {
			driver.ioctl(opened, 0x40045564, 1);
			for (let usage = 0; usage <= 231; usage++) {
				const code = linuxKeyCode(usage);
				if (code !== undefined) driver.ioctl(opened, 0x40045565, code);
			}
			const setup = Buffer.alloc(92);
			setup.writeUInt16LE(3, 0);
			setup.writeUInt16LE(0x4158, 2);
			setup.writeUInt16LE(0x514b, 4);
			setup.write("open-quake host shortcuts", 8, "utf8");
			driver.ioctl(opened, 0x405c5503, setup);
			driver.ioctl(opened, 0x5501, 0);
			fd = opened;
			return opened;
		} catch (cause) {
			driver.close(opened);
			throw cause;
		}
	};
	return {
		available: () => {
			try {
				initialize();
				return true;
			} catch {
				return false;
			}
		},
		post: (usage: number, down: boolean, _flags: number) => {
			const code = linuxKeyCode(usage);
			if (code === undefined) throw new Error("uinput-key-unavailable");
			// input_event uses two native 64-bit longs on supported x64/arm64 Linux.
			const events = Buffer.alloc(48);
			events.writeUInt16LE(1, 16);
			events.writeUInt16LE(code, 18);
			events.writeInt32LE(down ? 1 : 0, 20);
			driver.write(initialize(), events);
		},
		close: () => {
			if (fd === undefined) return;
			const opened = fd;
			fd = undefined;
			try {
				driver.ioctl(opened, 0x5502, 0);
			} finally {
				driver.close(opened);
			}
		},
	};
}
