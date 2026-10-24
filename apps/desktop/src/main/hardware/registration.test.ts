import { EventEmitter } from "node:events";
import { ipcMain, powerMonitor } from "electron";
import { describe, expect, it, vi } from "vitest";
import { registerHardware } from "./index";

vi.mock("electron", () => ({
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
	powerMonitor: new EventEmitter(),
}));

describe("hardware IPC registration", () => {
	it("accepts only the current management top frame and removes OS listeners on disposal", async () => {
		const management = {
			webContents: {
				mainFrame: {},
				getURL: () => "file:///app/index.html?surface=management",
			},
		};
		const dispose = registerHardware(
			() => undefined,
			() => management,
			true,
			"file:///app/index.html",
		);
		const handler = vi.mocked(ipcMain.handle).mock.calls[0]?.[1];
		if (!handler) throw new Error("Missing handler");
		const good = {
			sender: management.webContents,
			senderFrame: management.webContents.mainFrame,
		};
		expect(
			await Reflect.apply(handler, undefined, [good, { _tag: "read" }]),
		).toEqual({ _tag: "offline" });
		for (const event of [
			{ ...good, senderFrame: {} },
			{ ...good, sender: { ...management.webContents } },
			{
				...good,
				sender: {
					mainFrame: good.senderFrame,
					getURL: () => "file:///foreign.html",
				},
			},
		])
			expect(
				await Reflect.apply(handler, undefined, [event, { _tag: "read" }]),
			).toEqual({ _tag: "failure", code: "QUAKE.HARDWARE.REQUEST_DENIED" });
		expect(powerMonitor.listenerCount("lock-screen")).toBe(1);
		expect(powerMonitor.listenerCount("unlock-screen")).toBe(1);
		dispose();
		expect(powerMonitor.listenerCount("lock-screen")).toBe(0);
		expect(powerMonitor.listenerCount("unlock-screen")).toBe(0);
		expect(ipcMain.removeHandler).toHaveBeenCalledWith("hardware:request");
	});
});
