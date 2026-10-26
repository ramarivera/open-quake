import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
import { MANAGEMENT_COMMAND } from "../../shared/management";
import { createDesktopShell } from "./desktop-shell";

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
		template: [] as Electron.MenuItemConstructorOptions[],
		fail: false,
		destroy: vi.fn(),
		events: new Map<string, () => void>(),
	};
});
vi.mock("electron", () => ({
	ipcMain: {
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
function fixture(platform = "linux", locale = () => "en") {
	const win = Object.assign(new EventEmitter(), {
		webContents: Object.assign(new EventEmitter(), {
			mainFrame: { url: "https://app.test/index.html?surface=management" },
			send: vi.fn(),
			isLoadingMainFrame: () => false,
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
