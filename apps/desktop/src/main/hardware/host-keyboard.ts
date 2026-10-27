import { Effect, Either } from "effect";
import { systemPreferences } from "electron";
import koffi from "koffi";
import { linuxKeyboardPort } from "./host-keyboard-linux";
import { HostActionFailed } from "../../../../../packages/device/src/actions/action-errors";
import {
	deviceKeyboardTokens,
	encodeDeviceChord,
} from "../../../../../packages/device/src/hardware/hardware-invariants";

/** USB usage to macOS virtual key code. No keyboard layout translation or foreground activation. */
const macKeys: Readonly<Record<number, number>> = {
	4: 0,
	5: 11,
	6: 8,
	7: 2,
	8: 14,
	9: 3,
	10: 5,
	11: 4,
	12: 34,
	13: 38,
	14: 40,
	15: 37,
	16: 46,
	17: 45,
	18: 31,
	19: 35,
	20: 12,
	21: 15,
	22: 1,
	23: 17,
	24: 32,
	25: 9,
	26: 13,
	27: 7,
	28: 16,
	29: 6,
	30: 18,
	31: 19,
	32: 20,
	33: 21,
	34: 23,
	35: 22,
	36: 26,
	37: 28,
	38: 25,
	39: 29,
	40: 36,
	41: 53,
	42: 51,
	43: 48,
	44: 49,
	45: 27,
	46: 24,
	47: 33,
	48: 30,
	49: 42,
	51: 41,
	52: 39,
	53: 50,
	54: 43,
	55: 47,
	56: 44,
	57: 57,
	58: 122,
	59: 120,
	60: 99,
	61: 118,
	62: 96,
	63: 97,
	64: 98,
	65: 100,
	66: 101,
	67: 109,
	68: 103,
	69: 111,
	73: 114,
	74: 115,
	75: 116,
	76: 117,
	77: 119,
	78: 121,
	79: 124,
	80: 123,
	81: 125,
	82: 126,
	83: 71,
	104: 105,
	105: 107,
	106: 113,
	107: 106,
	108: 64,
	109: 79,
	110: 80,
	111: 90,
};
const modifiers = [
	{ bit: 1, key: 59, flag: 1 << 18 },
	{ bit: 2, key: 56, flag: 1 << 17 },
	{ bit: 4, key: 58, flag: 1 << 19 },
	{ bit: 8, key: 55, flag: 1 << 20 },
	{ bit: 16, key: 62, flag: 1 << 18 },
	{ bit: 32, key: 60, flag: 1 << 17 },
	{ bit: 64, key: 61, flag: 1 << 19 },
	{ bit: 128, key: 54, flag: 1 << 20 },
];
export interface NativeKeyboardPort {
	readonly available: () => boolean;
    readonly code?: (usage: number) => number | undefined;
    readonly close?: () => void;
	readonly post: (key: number, down: boolean, flags: number) => void;
}
let native: NativeKeyboardPort | undefined;
export function nativeKeyboardPort(): NativeKeyboardPort {
	if (native) return native;
	if (process.platform === "linux") {
        native = {...linuxKeyboardPort(), code: (usage) => usage};
        return native;
    }
    if (process.platform !== "darwin")
		return {
			available: () => false,
			post: () => {
				throw new Error("host-keyboard-platform-unavailable");
			},
		};
	const cg = koffi.load(
		"/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices",
	);
	const cf = koffi.load(
		"/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
	);
	const create = cg.func(
		"void *CGEventCreateKeyboardEvent(void *source, uint16_t key, bool down)",
	);
	const flags = cg.func("void CGEventSetFlags(void *event, uint64_t flags)");
	const post = cg.func("void CGEventPost(uint32_t tap, void *event)");
	const release = cf.func("void CFRelease(void *value)");
	native = {
		available: () => systemPreferences.isTrustedAccessibilityClient(false),
		post: (key, down, mask) => {
			const event: unknown = create(null, key, down);
			if (!event) throw new Error("host-keyboard-event-unavailable");
			try {
				flags(event, mask);
				post(0, event);
			} finally {
				release(event);
			}
		},
	};
	return native;
}
export const hostKeyboardAvailable = (): boolean => {
	try {
		return nativeKeyboardPort().available();
	} catch {
		return false;
	}
};
export function hostKeyboardAdapter(
	port: NativeKeyboardPort = nativeKeyboardPort(),
) {
	const holdChord = Effect.fn("HostKeyboard.holdChord")(function* (
		chord: string,
	) {
		if (!port.available())
			return yield* new HostActionFailed(
				"host-keyboard-permission-unavailable",
			);
		const encoded = encodeDeviceChord(chord);
		if (Either.isLeft(encoded))
			return yield* new HostActionFailed(encoded.left);
		const { usage, modifiers: mask } = encoded.right;
		const key = port.code ? port.code(usage) : macKeys[usage];
		if (usage !== 0 && key === undefined)
			return yield* new HostActionFailed("host-keyboard-key-unavailable");
		const held = modifiers.filter((m) => (mask & m.bit) !== 0);
		const pressed: { key: number; flags: number }[] = [];
		const release = Effect.try({
			try: () => {
				let failure: unknown;
				for (const item of [...pressed].reverse())
					try {
						port.post(item.key, false, 0);
					} catch (cause) {
						failure ??= cause;
					}
				pressed.length = 0;
				if (failure) throw failure;
			},
			catch: (cause) => new HostActionFailed(cause),
		});
		yield* Effect.try({
			try: () => {
				let flags = 0;
				for (const m of held) {
					flags |= m.flag;
					const code = port.code ? port.code(224 + modifiers.indexOf(m)) : m.key;
                    if (code === undefined) throw new Error("host-keyboard-modifier-unavailable");
                    pressed.push({ key: code, flags });
                    port.post(code, true, flags);
				}
				if (key !== undefined) {
					pressed.push({ key, flags });
                    port.post(key, true, flags);
				}
			},
			catch: (cause) => new HostActionFailed(cause),
		}).pipe(Effect.onError(() => release.pipe(Effect.ignore)));
		return release;
	});
	return {
		supportedTokens: deviceKeyboardTokens,
		holdChord,
		pressChord: Effect.fn("HostKeyboard.pressChord")(function* (chord: string) {
			const release = yield* holdChord(chord);
			let releaseError: HostActionFailed | undefined;
			yield* Effect.sleep(50).pipe(
				Effect.ensuring(
					release.pipe(
						Effect.catchTag("HostActionFailed", (error) =>
							Effect.sync(() => {
								releaseError = error;
							}),
						),
					),
				),
			);
			if (releaseError) return yield* releaseError;
		}),
	};
}

export function closeHostKeyboard(): void { native?.close?.(); native = undefined; }
