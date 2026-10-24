import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { type BrowserWindow, ipcMain, nativeTheme } from "electron";
import { MANAGEMENT_THEME, NativeThemeRequest } from "../../shared/management";
import { isAppRenderer } from "../profiles/profile-ipc";

const decode = Schema.decodeUnknownOption(NativeThemeRequest);
export function readNativeTheme(root: string): typeof NativeThemeRequest.Type {
	try {
		const value: unknown = JSON.parse(
			readFileSync(join(root, "management-theme.json"), "utf8"),
		);
		const result = decode(value);
		if (result._tag === "Some") return result.value;
	} catch {
		/* First run or unreadable cache uses DK's Grey default. */
	}
	return {
		base: "dark",
		background: "#282828",
		titlebar: "#282828",
		symbol: "#f0f0f0",
	};
}
export function registerManagementAppearance(
	management: () => BrowserWindow,
	root: string,
	renderer: string,
): () => void {
	ipcMain.handle(MANAGEMENT_THEME, (event, input: unknown) => {
		const win = management();
		if (
			win.isDestroyed() ||
			event.sender !== win.webContents ||
			event.senderFrame !== win.webContents.mainFrame ||
			!isAppRenderer(event.sender.getURL(), renderer)
		)
			return false;
		const theme = decode(input);
		if (theme._tag === "None") return false;
		nativeTheme.themeSource = theme.value.base;
		win.setBackgroundColor(theme.value.background);
		if (process.platform === "win32")
			win.setTitleBarOverlay({
				color: theme.value.titlebar,
				symbolColor: theme.value.symbol,
				height: 55,
			});
		try {
			writeFileSync(
				join(root, "management-theme.json"),
				JSON.stringify(theme.value),
			);
		} catch {
			/* Session appearance still applies; renderer owns persistence notices. */
		}
		return true;
	});
	return () => ipcMain.removeHandler(MANAGEMENT_THEME);
}
