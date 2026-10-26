import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
import {
	MANAGEMENT_COMMAND,
	MANAGEMENT_EXTERNAL,
} from "../../shared/management";
import { managementExternalLinks } from "../../shared/management-external";
import { createDesktopShell } from "./desktop-shell";
import { registerManagementNavigation } from "./external-navigation";

type Sender = {
	readonly sender: object;
	readonly senderFrame: { readonly url?: string } | null;
};
const native = vi.hoisted(() => {
	const handlers = new Map<
		string,
		(event: Sender, input: unknown) => unknown
	>();
	return {
		handlers,
		listeners: new Map<string, (event: Sender, value: unknown) => void>(),
		openExternal: vi.fn(async (_url: string) => {}),
		template: [] as Electron.MenuItemConstructorOptions[],
		fail: false,
		destroy: vi.fn(),
		events: new Map<string, () => void>(),
	};
});
vi.mock("electron", () => ({
	shell: { openExternal: native.openExternal },
	ipcMain: {
		on: (name: string, listener: (event: Sender, value: unknown) => void) =>
			native.listeners.set(name, listener),
		removeListener: (name: string) => native.listeners.delete(name),
		handle: (
			name: string,
			handler: (event: Sender, input: unknown) => unknown,
		) => native.handlers.set(name, handler),
		removeHandler: (name: string) => native.handlers.delete(name),
	},
	nativeImage: { createFromBitmap: () => ({ setTemplateImage: vi.fn() }) },
	Menu: {
		buildFromTemplate: (items: Electron.MenuItemConstructorOptions[]) => {
			native.template = items;
			return items;
		},
	},
	Tray: class {
		constructor() {
			if (native.fail) throw new Error("unsupported desktop tray");
		}
		setToolTip = vi.fn();
		setContextMenu = vi.fn();
		destroy = native.destroy;
		on(name: string, callback: () => void) {
			native.events.set(name, callback);
		}
	},
}));
function fixture(
	platform = "linux",
	locale = () => "en",
	keepVisible = () => false,
) {
	const win = Object.assign(new EventEmitter(), {
		webContents: Object.assign(new EventEmitter(), {
			mainFrame: { url: "https://app.test/index.html?surface=management" },
			send: vi.fn(),
			isLoadingMainFrame: () => false,
			setWindowOpenHandler:
				vi.fn<
					(handler: (details: { url: string }) => { action: "deny" }) => void
				>(),
		}),
		isDestroyed: () => false,
		hide: vi.fn(),
		close: vi.fn(),
		minimize: vi.fn(),
		maximize: vi.fn(),
		unmaximize: vi.fn(),
		isMaximized: vi.fn(() => false),
	});
	// The fixture structurally implements only the BrowserWindow methods used by this owner.
	const management = () => win;
	const quit = vi.fn(),
		focus = vi.fn();
	const shell = createDesktopShell({
		management,
		renderer: "https://app.test/index.html",
		focus,
		quit,
		quitting: () => false,
		platform,
		locale,
		keepVisible,
	});
	const event = {
		sender: win.webContents,
		senderFrame: win.webContents.mainFrame,
	};
	const command = (input: unknown, from: Sender = event) =>
		native.handlers.get(MANAGEMENT_COMMAND)?.(from, input);
	return { win, shell, quit, focus, event, command };
}
beforeEach(() => {
	native.handlers.clear();
	native.listeners.clear();
	native.openExternal.mockClear();
	native.events.clear();
	native.fail = false;
	native.destroy.mockClear();
});
it("MAIN-121/122 SETTINGS-112/113 tray routes, double-click and background close preserve the owner", () => {
	const f = fixture();
	try {
		expect(native.template.map((item) => item.label).filter(Boolean)).toEqual([
			"Resume",
			"Settings",
			"Management Center",
			"Exit",
		]);
		for (const index of [0, 1, 2, 4]) {
			const item = native.template[index];
			if (item && typeof item.click === "function")
				Reflect.apply(item.click, undefined, []);
		}
		expect(f.focus).toHaveBeenCalledTimes(3);
		expect(f.win.webContents.send.mock.calls).toEqual([
			["management:activate", "settings"],
			["management:activate", "overview"],
		]);
		expect(f.quit).toHaveBeenCalledWith(false);
		native.events.get("double-click")?.();
		expect(f.focus).toHaveBeenCalledTimes(4);
		const event = { preventDefault: vi.fn() };
		f.win.emit("close", event);
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(f.win.hide).toHaveBeenCalledOnce();
	} finally {
		f.shell.dispose();
	}
	expect(native.destroy).toHaveBeenCalledOnce();
	expect(f.win.listenerCount("close")).toBe(0);
	native.events.get("double-click")?.();
	expect(f.focus).toHaveBeenCalledTimes(4);
});
it("MGMT-015/019 MAIN-127 exact main-frame identity and decoded commands gate native actions", () => {
	const f = fixture();
	try {
		for (const action of ["minimize", "maximize", "hide", "quit", "restart"])
			expect(f.command({ action })).toBe(true);
		expect(f.win.minimize).toHaveBeenCalledOnce();
		expect(f.win.maximize).toHaveBeenCalledOnce();
		f.win.isMaximized.mockReturnValue(true);
		f.command({ action: "maximize" });
		expect(f.win.unmaximize).toHaveBeenCalledOnce();
		expect(f.quit.mock.calls).toEqual([[false], [true]]);
		for (const from of [
			{ ...f.event, sender: {} },
			{ ...f.event, senderFrame: {} },
		])
			expect(f.command({ action: "quit" }, from)).toBe(false);
		f.win.webContents.mainFrame.url = "https://evil.test/index.html";
		expect(f.command({ action: "quit" })).toBe(false);
		f.win.webContents.mainFrame.url = "https://app.test/index.html";
		expect(f.command({ action: "unknown" })).toBe(false);
		expect(f.command({ action: "quit", injected: true })).toBe(false);
		expect(f.quit).toHaveBeenCalledTimes(2);
	} finally {
		f.shell.dispose();
	}
	expect(native.handlers.has(MANAGEMENT_COMMAND)).toBe(false);
});
it.each(["linux", "win32", "darwin"])(
	"SETTINGS-112 tray failure on %s retains Dock recovery only on macOS",
	(platform) => {
		native.fail = true;
		const f = fixture(platform);
		try {
			expect(f.shell.recoverable()).toBe(platform === "darwin");
			const event = { preventDefault: vi.fn() };
			f.win.emit("close", event);
			expect(event.preventDefault).toHaveBeenCalledTimes(
				platform === "darwin" ? 1 : 0,
			);
		} finally {
			f.shell.dispose();
		}
	},
);

it("SETTINGS-112 refreshes native tray labels from the current app locale", () => {
	let locale = "en";
	const f = fixture("linux", () => locale);
	locale = "de";
	f.shell.refresh();
	expect(native.template.map((item) => item.label)).toEqual([
		"Fortsetzen",
		"Einstellungen",
		"Verwaltungszentrum",
		undefined,
		"Beenden",
	]);
	f.shell.dispose();
});

it("SETTINGS-002 rejects close/hide during privacy handoff but permits explicit quit", () => {
	let pinned = true;
	const f = fixture(
		"darwin",
		() => "en",
		() => pinned,
	);
	try {
		const event = { preventDefault: vi.fn() };
		f.win.emit("close", event);
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(f.command({ action: "hide" })).toBe(true);
		expect(f.focus).toHaveBeenCalledTimes(2);
		expect(f.win.hide).not.toHaveBeenCalled();
		expect(f.command({ action: "quit" })).toBe(true);
		expect(f.quit).toHaveBeenCalledWith(false);
		pinned = false;
		f.win.emit("close", event);
		expect(f.win.hide).toHaveBeenCalledOnce();
	} finally {
		f.shell.dispose();
	}
});

it("external links require an exact destination and trusted management main frame", () => {
	const f = fixture();
	registerManagementNavigation(
		f.win.webContents,
		"https://app.test/index.html",
	);
	const open = (url: unknown, event: Sender = f.event) =>
		native.listeners.get(MANAGEMENT_EXTERNAL)?.(event, url);
	for (const url of managementExternalLinks) open(url);
	expect(native.openExternal.mock.calls).toEqual(
		managementExternalLinks.map((url) => [url]),
	);
	native.openExternal.mockClear();
	for (const url of [
		"https://evil.test",
		"https://github.com/ramarivera/open-quake?secret=private",
		"https://github.com/ramarivera/open-quake#private",
		"https://github.com/ramarivera/open-quake/redirect",
		"https://user:pass@github.com/ramarivera/open-quake",
		"javascript:alert(1)",
		"file:///etc/passwd",
		"mailto:attacker@example.com",
		{ url: managementExternalLinks[0] },
	])
		open(url);
	open(managementExternalLinks[0], { ...f.event, sender: {} });
	open(managementExternalLinks[0], {
		...f.event,
		senderFrame: { ...f.win.webContents.mainFrame },
	});
	f.win.webContents.mainFrame.url =
		"https://evil.test/index.html?surface=management";
	open(managementExternalLinks[0]);
	f.win.webContents.mainFrame.url = "https://app.test/index.html?surface=panel";
	open(managementExternalLinks[0]);
	expect(native.openExternal).not.toHaveBeenCalled();
	for (const name of ["will-navigate", "will-frame-navigate"]) {
		const event = { preventDefault: vi.fn() };
		f.win.webContents.emit(name, event, managementExternalLinks[0]);
		expect(event.preventDefault).toHaveBeenCalledOnce();
	}
	const popup = f.win.webContents.setWindowOpenHandler.mock.calls[0]?.[0];
	expect(popup?.({ url: managementExternalLinks[0] })).toEqual({
		action: "deny",
	});
	expect(native.openExternal).not.toHaveBeenCalled();
	f.win.webContents.emit("destroyed");
	expect(native.listeners.has(MANAGEMENT_EXTERNAL)).toBe(false);
	f.shell.dispose();
});

it("automatic navigation and child-frame popups cannot open the system browser", () => {
	const f = fixture();
	registerManagementNavigation(
		f.win.webContents,
		"https://app.test/index.html",
	);
	f.win.webContents.emit(
		"will-navigate",
		{ preventDefault: vi.fn() },
		"https://evil.test/leak",
	);
	f.win.webContents.setWindowOpenHandler.mock.calls[0]?.[0]({
		url: "https://evil.test/leak",
	});
	expect(native.openExternal).not.toHaveBeenCalled();
	f.win.webContents.emit("destroyed");
	f.shell.dispose();
});
