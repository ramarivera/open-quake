import koffi from "koffi";

/** Only window ownership/layer is inspected; window titles never leave CoreGraphics. */
export function createNativeOverviewReader() {
	let read: (() => boolean) | undefined;
	let release: (() => void) | undefined;
	return {
		visible: (): boolean | undefined => {
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
					const dock: unknown = string(null, "Dock", 0x08000100);
					const manager: unknown = string(null, "WindowManager", 0x08000100);
					release = () => {
						for (const key of [owner, layer, dock, manager]) if (key) free(key);
					};
					if (!owner || !layer || !dock || !manager)
						throw Error("overview-key-unavailable");
					read = () => {
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
								// Older macOS uses Dock/18; current macOS uses WindowManager/19.
								if (
									(decoded[0] === 18 && equal(owned, dock)) ||
									(decoded[0] === 19 && equal(owned, manager))
								)
									return true;
							}
							return false;
						} finally {
							free(list);
						}
					};
				}
				return read();
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
