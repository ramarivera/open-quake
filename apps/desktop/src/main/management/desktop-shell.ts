import { Schema } from "effect";
import { ipcMain, Menu, nativeImage, Tray } from "electron";
import {
	MANAGEMENT_ACTIVATE,
	MANAGEMENT_COMMAND,
	MANAGEMENT_READY,
	ShellCommand,
} from "../../shared/management";
import { isAppRenderer } from "../profiles/profile-ipc";
import { nativeLocaleMenu } from "../settings/native-locale";

export interface ShellWindow {
	readonly isDestroyed: () => boolean;
	readonly webContents: {
		readonly mainFrame: { readonly url: string };
		readonly send: (channel: string, value: string) => void;
		on(
			event: "did-start-navigation",
			callback: (details: {
				readonly isMainFrame: boolean;
				readonly isSameDocument?: boolean;
			}) => void,
		): unknown;
		removeListener(
			event: "did-start-navigation",
			callback: (details: {
				readonly isMainFrame: boolean;
				readonly isSameDocument?: boolean;
			}) => void,
		): unknown;
	};
	readonly hide: () => void;
	readonly close: () => void;
	readonly minimize: () => void;
	readonly maximize: () => void;
	readonly unmaximize: () => void;
	readonly isMaximized: () => boolean;
	on(
		event: "close",
		callback: (event: { preventDefault(): void }) => void,
	): unknown;
	on(event: "closed", callback: () => void): unknown;
	removeListener(
		event: "close",
		callback: (event: { preventDefault(): void }) => void,
	): unknown;
	removeListener(event: "closed", callback: () => void): unknown;
}

/** Native shell ownership stays separate from the service graph and its writers. */
export function createDesktopShell(options: {
	readonly management: () => ShellWindow;
	readonly renderer: string;
	readonly focus: () => void;
	readonly quit: (restart: boolean) => void;
	readonly quitting: () => boolean;
	readonly keepVisible?: () => boolean;
	readonly platform?: string;
	readonly locale?: () => string;
}) {
	const platform = options.platform ?? process.platform;
	let disposed = false;
	let tray: Tray | undefined;
	const attached = new Map<ShellWindow, () => void>();
	const ready = new Set<ShellWindow>();
	const pending = new Map<ShellWindow, string>();
	const flush = (win: ShellWindow) => {
		const page = pending.get(win);
		if (
			!page ||
			!ready.has(win) ||
			disposed ||
			options.quitting() ||
			win.isDestroyed()
		)
			return;
		pending.delete(win);
		win.webContents.send(MANAGEMENT_ACTIVATE, page);
	};
	const recoverable = () => !!tray || platform === "darwin";
	const open = (page?: string) => {
		if (disposed || options.quitting()) return;
		options.focus();
		const win = options.management();
		if (!page || win.isDestroyed()) return;
		pending.set(win, page);
		flush(win);
	};
	const refresh = () => {
		if (!tray || disposed) return;
		tray.setContextMenu(
			Menu.buildFromTemplate(
				nativeLocaleMenu(options.locale?.() ?? "en", {
					resume: () => open(),
					settings: () => open("settings"),
					management: () => open("overview"),
					exit: () => {
						if (!disposed) options.quit(false);
					},
				}),
			),
		);
	};

	try {
		// An app-owned monochrome knob icon, generated at native bitmap size.
		const size = platform === "darwin" ? 18 : 22;
		const pixels = Buffer.alloc(size * size * 4);
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				const radius = Math.hypot(x - size / 2, y - size / 2);
				if (
					(radius > size * 0.29 && radius < size * 0.44) ||
					(Math.abs(x - size / 2) < 1 && y > size * 0.15 && y < size * 0.43)
				) {
					const offset = (y * size + x) * 4;
					pixels.fill(255, offset, offset + 4);
				}
			}
		const icon = nativeImage.createFromBitmap(pixels, {
			width: size,
			height: size,
		});
		if (platform === "darwin") icon.setTemplateImage(true);
		tray = new Tray(icon);
		tray.setToolTip("open-quake");
		refresh();
		tray.on("double-click", () => open());
	} catch {
		tray?.destroy();
		tray = undefined;
	}
	const attach = (win: ShellWindow) => {
		if (disposed || attached.has(win)) return;
		const close = (event: { preventDefault(): void }) => {
			if (!disposed && !options.quitting() && options.keepVisible?.()) {
				event.preventDefault();
				options.focus();
				return;
			}
			if (!disposed && !options.quitting() && recoverable()) {
				event.preventDefault();
				win.hide();
			}
		};
		const navigating = (details: {
			readonly isMainFrame: boolean;
			readonly isSameDocument?: boolean;
		}) => {
			if (details.isMainFrame && !details.isSameDocument) ready.delete(win);
		};
		const detach = () => {
			ready.delete(win);
			pending.delete(win);
			win.webContents.removeListener("did-start-navigation", navigating);
			win.removeListener("close", close);
			win.removeListener("closed", detach);
			attached.delete(win);
		};
		win.webContents.on("did-start-navigation", navigating);
		win.on("close", close);
		win.on("closed", detach);
		attached.set(win, detach);
	};
	const rendererReady = (event: Electron.IpcMainEvent) => {
		const win = options.management();
		if (
			disposed ||
			options.quitting() ||
			win.isDestroyed() ||
			event.sender !== win.webContents ||
			event.senderFrame !== win.webContents.mainFrame ||
			!isAppRenderer(event.senderFrame?.url ?? "", options.renderer) ||
			new URL(event.senderFrame?.url ?? options.renderer).searchParams.get(
				"surface",
			) !== "management"
		)
			return;
		ready.add(win);
		flush(win);
	};
	ipcMain.on(MANAGEMENT_READY, rendererReady);
	ipcMain.handle(MANAGEMENT_COMMAND, (event, input: unknown) => {
		const win = options.management();
		if (
			disposed ||
			options.quitting() ||
			win.isDestroyed() ||
			event.sender !== win.webContents ||
			event.senderFrame !== win.webContents.mainFrame ||
			!isAppRenderer(event.senderFrame?.url ?? "", options.renderer)
		)
			return false;
		const result = Schema.decodeUnknownOption(ShellCommand, {
			onExcessProperty: "error",
		})(input);
		if (result._tag === "None") return false;
		switch (result.value.action) {
			case "quit":
				options.quit(false);
				break;
			case "restart":
				options.quit(true);
				break;
			case "minimize":
				win.minimize();
				break;
			case "maximize":
				if (win.isMaximized()) win.unmaximize();
				else win.maximize();
				break;
			case "hide":
				if (options.keepVisible?.()) options.focus();
				else if (recoverable()) win.hide();
				else win.close();
				break;
		}
		return true;
	});
	attach(options.management());
	return {
		attach,
		open,
		refresh,
		recoverable,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			ipcMain.removeHandler(MANAGEMENT_COMMAND);
			ipcMain.removeListener(MANAGEMENT_READY, rendererReady);
			for (const detach of attached.values()) detach();
			tray?.destroy();
			tray = undefined;
		},
	};
}
