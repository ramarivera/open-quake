import koffi from "koffi";

/** Inspect identifiers in Siri's windows, never search text or result titles. */
export function createNativeAppsReader() {
	let read: ((pid: number) => boolean | undefined) | undefined;
	let release: (() => void) | undefined;
	return {
		visible: (pid: number): boolean | undefined => {
			try {
				if (!read) {
					const ax = koffi.load(
						"/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices",
					);
					const cf = koffi.load(
						"/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
					);
					const trusted = ax.func("bool AXIsProcessTrusted()");
					const application = ax.func(
						"void *AXUIElementCreateApplication(int pid)",
					);
					const timeout = ax.func(
						"int AXUIElementSetMessagingTimeout(void *element, float seconds)",
					);
					const copy = ax.func(
						"int AXUIElementCopyAttributeValue(void *element, void *attribute, _Out_ void **value)",
					);
					const count = cf.func("long CFArrayGetCount(void *array)");
					const item = cf.func(
						"void *CFArrayGetValueAtIndex(void *array, long index)",
					);
					const string = cf.func(
						"void *CFStringCreateWithCString(void *allocator, const char *text, uint32_t encoding)",
					);
					const prefix = cf.func(
						"bool CFStringHasPrefix(void *string, void *prefix)",
					);
					const suffix = cf.func(
						"bool CFStringHasSuffix(void *string, void *suffix)",
					);
					const free = cf.func("void CFRelease(void *value)");
					const keys: unknown[] = [];
					release = () => {
						for (const key of keys) free(key);
					};
					for (const name of [
						"AXWindows",
						"AXChildren",
						"AXIdentifier",
						"Identifier:GridCell,",
						"Bundle:com.apple.spotlight.zkw.apps",
					]) {
						const key: unknown = string(null, name, 0x08000100);
						if (!key) throw Error("apps-key-unavailable");
						keys.push(key);
					}
					const [windows, children, identifier, grid, apps] = keys;
					read = (pid) => {
						if (!trusted()) return undefined;
						const app: unknown = application(pid);
						if (!app) return undefined;
						try {
							if (timeout(app, 0.05) !== 0) return undefined;
							const deadline = performance.now() + 50;
							let visited = 0;
							const attribute = (element: unknown, key: unknown): unknown => {
								const value: unknown[] = [null];
								const status: number = copy(element, key, value);
								if (status === -25205 || status === -25212) return undefined;
								if (status !== 0) throw Error("apps-attribute-unavailable");
								return value[0];
							};
							const walk = (element: unknown, depth: number): boolean => {
								if (
									++visited > 400 ||
									depth > 16 ||
									performance.now() > deadline
								)
									throw Error("apps-read-budget");
								const id = attribute(element, identifier);
								if (id) {
									try {
										if (prefix(id, grid) && suffix(id, apps)) return true;
									} finally {
										free(id);
									}
								}
								const list = attribute(element, children);
								return list ? walkList(list, depth + 1) : false;
							};
							const walkList = (list: unknown, depth: number): boolean => {
								try {
									for (let index = count(list) - 1; index >= 0; index--) {
										const child: unknown = item(list, index);
										if (child && walk(child, depth)) return true;
									}
									return false;
								} finally {
									free(list);
								}
							};
							const list = attribute(app, windows);
							return list ? walkList(list, 0) : undefined;
						} finally {
							free(app);
						}
					};
				}
				return read(pid);
			} catch {
				if (!read) {
					release?.();
					release = undefined;
				}
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
