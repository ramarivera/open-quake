import { Schema } from "effect";
import { ipcMain, Menu, nativeImage, Tray } from "electron";
import {
	MANAGEMENT_ACTIVATE,
	MANAGEMENT_COMMAND,
	ShellCommand,
} from "../../shared/management";
import { isAppRenderer } from "../profiles/profile-ipc";

export interface ShellWindow {
	readonly isDestroyed: () => boolean;
	readonly webContents: {
		readonly mainFrame: { readonly url: string };
		readonly send: (channel: string, value: string) => void;
		readonly isLoadingMainFrame: () => boolean;
		readonly once: (event: "did-finish-load", callback: () => void) => unknown;
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
	readonly platform?: string;
}) {
	const platform = options.platform ?? process.platform;
	let disposed = false;
	let tray: Tray | undefined;
	const attached = new Map<ShellWindow, () => void>();
	const recoverable = () => !!tray || platform === "darwin";
	const open = (page?: string) => {
		if (disposed || options.quitting()) return;
		options.focus();
		const win = options.management();
		if (!page || win.isDestroyed()) return;
		const send = () => {
			if (!disposed && !win.isDestroyed() && win === options.management())
				win.webContents.send(MANAGEMENT_ACTIVATE, page);
		};
		if (win.webContents.isLoadingMainFrame())
			win.webContents.once("did-finish-load", send);
		else send();
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
		tray.setContextMenu(
			Menu.buildFromTemplate([
				{ label: "Resume", click: () => open() },
				{ label: "Settings", click: () => open("settings") },
				{ label: "Management Center", click: () => open("overview") },
				{ type: "separator" },
				{
					label: "Exit",
					click: () => {
						if (!disposed) options.quit(false);
					},
				},
			]),
		);
		tray.on("double-click", () => open());
	} catch {
		tray?.destroy();
		tray = undefined;
	}
	const attach = (win: ShellWindow) => {
		if (disposed || attached.has(win)) return;
		const close = (event: { preventDefault(): void }) => {
			if (!disposed && !options.quitting() && recoverable()) {
				event.preventDefault();
				win.hide();
			}
		};
		const detach = () => {
			win.removeListener("close", close);
			win.removeListener("closed", detach);
			attached.delete(win);
		};
		win.on("close", close);
		win.on("closed", detach);
		attached.set(win, detach);
	};
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
				if (recoverable()) win.hide();
				else win.close();
				break;
		}
		return true;
	});
	attach(options.management());
	return {
		attach,
		recoverable,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			ipcMain.removeHandler(MANAGEMENT_COMMAND);
			for (const detach of attached.values()) detach();
			tray?.destroy();
			tray = undefined;
		},
	};
}
