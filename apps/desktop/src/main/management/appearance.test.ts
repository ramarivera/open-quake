import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserWindow, ipcMain, nativeTheme } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { MANAGEMENT_THEME } from "../../shared/management";
import { readNativeTheme, registerManagementAppearance } from "./appearance";

vi.mock("electron", () => ({
	BrowserWindow: class {
		webContents = {
			mainFrame: {},
			getURL: () => "file:///renderer/index.html",
		};
		isDestroyed = vi.fn(() => false);
		setBackgroundColor = vi.fn();
		setTitleBarOverlay = vi.fn();
	},
	ipcMain: {
		handle: vi.fn<(channel: string, listener: unknown) => void>(),
		removeHandler: vi.fn(),
	},
	nativeTheme: { themeSource: "system" },
}));
const platform = Object.getOwnPropertyDescriptor(process, "platform");
afterEach(() => {
	if (platform) Object.defineProperty(process, "platform", platform);
});

it("CENTER-002 applies and persists Windows overlay updates through the validated main handler", async () => {
	Object.defineProperty(process, "platform", {
		value: "win32",
		configurable: true,
	});
	const root = await mkdtemp(join(tmpdir(), "oq-appearance-"));
	const win = new BrowserWindow();
	const dispose = registerManagementAppearance(
		() => win,
		root,
		"file:///renderer/index.html",
	);
	try {
		const handler: unknown = vi
			.mocked(ipcMain.handle)
			.mock.calls.find(([name]) => name === MANAGEMENT_THEME)?.[1];
		if (typeof handler !== "function") throw new Error("Missing theme handler");
		const event = {
			sender: win.webContents,
			senderFrame: win.webContents.mainFrame,
		};
		for (const theme of [
			{
				base: "light",
				background: "#ffffff",
				titlebar: "#eeeeee",
				symbol: "#111111",
			},
			{
				base: "dark",
				background: "#121212",
				titlebar: "#222222",
				symbol: "#ffffff",
			},
		]) {
			expect(handler(event, theme)).toBe(true);
			expect(nativeTheme.themeSource).toBe(theme.base);
			expect(win.setBackgroundColor).toHaveBeenLastCalledWith(theme.background);
			expect(win.setTitleBarOverlay).toHaveBeenLastCalledWith({
				color: theme.titlebar,
				symbolColor: theme.symbol,
				height: 55,
			});
			expect(readNativeTheme(root)).toEqual(theme);
			expect(
				JSON.parse(await readFile(join(root, "management-theme.json"), "utf8")),
			).toEqual(theme);
		}
		expect(handler({ ...event, senderFrame: {} }, { base: "light" })).toBe(
			false,
		);
		expect(handler(event, { base: "light", background: "invalid" })).toBe(
			false,
		);
		expect(win.setTitleBarOverlay).toHaveBeenCalledTimes(2);
	} finally {
		dispose();
		await rm(root, { recursive: true, force: true });
	}
	expect(ipcMain.removeHandler).toHaveBeenCalledWith(MANAGEMENT_THEME);
});
