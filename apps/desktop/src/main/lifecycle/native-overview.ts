import koffi from "koffi";
import type { SystemOverviewMode } from "./system-overview";

/** Only window ownership/layer is inspected; window titles never leave CoreGraphics. */
export function createNativeOverviewReader() {
	let read: ((mode: SystemOverviewMode) => boolean) | undefined;
	let release: (() => void) | undefined;
	return {
		visible: (mode: SystemOverviewMode): boolean | undefined => {
			if (process.platform !== "darwin") return undefined;
			try {
				if (!read) {
					const cg = koffi.load(
						"/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
					);
					const cf = koffi.load(
						"/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
					);
					const windows = cg.func(
						"void *CGWindowListCopyWindowInfo(uint32_t option, uint32_t relative)",
					);
					const count = cf.func("long CFArrayGetCount(void *array)");
					const item = cf.func(
						"void *CFArrayGetValueAtIndex(void *array, long index)",
					);
					const value = cf.func(
						"void *CFDictionaryGetValue(void *dictionary, void *key)",
					);
					const string = cf.func(
						"void *CFStringCreateWithCString(void *allocator, const char *text, uint32_t encoding)",
					);
					const equal = cf.func("bool CFEqual(void *first, void *second)");
					const number = cf.func(
						"bool CFNumberGetValue(void *number, int type, _Out_ int *value)",
					);
					const free = cf.func("void CFRelease(void *value)");
					const owner: unknown = string(null, "kCGWindowOwnerName", 0x08000100);
					const layer: unknown = string(null, "kCGWindowLayer", 0x08000100);
					// Public window metadata observed during real open/close cycles.
					// Legacy Launchpad has no reliable match here and stays fail-closed.
					const matches: Record<
						SystemOverviewMode,
						readonly (readonly [string, number])[]
					> = {
						windows: [
							["Dock", 18],
							["WindowManager", 19],
						],
						apps: [["Siri", 23]],
						search: [["Siri", 23]],
						"force-quit": [["loginwindow", 996]],
						screenshot: [["screencapture", 1498]],
					};
					const owners = new Map<string, unknown>();
					release = () => {
						for (const key of [owner, layer, ...owners.values()])
							if (key) free(key);
					};
					if (!owner || !layer) throw Error("overview-key-unavailable");
					for (const [name] of Object.values(matches).flat()) {
						if (owners.has(name)) continue;
						const key: unknown = string(null, name, 0x08000100);
						if (!key) throw Error("overview-owner-unavailable");
						owners.set(name, key);
					}
					read = (mode) => {
						const list: unknown = windows(1, 0);
						if (!list) throw Error("overview-windows-unavailable");
						try {
							for (let index = 0; index < count(list); index++) {
								const entry: unknown = item(list, index);
								if (!entry) continue;
								const owned: unknown = value(entry, owner);
								const level: unknown = value(entry, layer);
								const decoded = [0];
								if (!owned || !level || !number(level, 9, decoded)) continue;
								if (
									matches[mode].some(
										([name, layer]) =>
											decoded[0] === layer && equal(owned, owners.get(name)),
									)
								)
									return true;
							}
							return false;
						} finally {
							free(list);
						}
					};
				}
				return read(mode);
			} catch {
				release?.();
				release = undefined;
				read = undefined;
				return undefined;
			}
		},
		dispose: () => {
			release?.();
			release = undefined;
			read = undefined;
		},
	};
}
