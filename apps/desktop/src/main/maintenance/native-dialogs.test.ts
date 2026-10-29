import type { BrowserWindow } from "electron";
import { expect, it, vi } from "vitest";
import { maintenanceDialogs } from "./native-dialogs";

const native = vi.hoisted(() => ({
	showMessageBox: vi.fn(async () => ({ response: 0 })),
	showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
	showSaveDialog: vi.fn(async () => ({ canceled: true })),
}));
vi.mock("electron", () => ({ dialog: native }));

it("cancels every dialog when its management owner is absent or destroyed", async () => {
	for (const window of [undefined, { isDestroyed: () => true }]) {
		const dialogs = maintenanceDialogs(
			() => window as BrowserWindow | undefined,
		);
		expect(
			await dialogs.message({
				message: "Continue?",
				buttons: ["Continue", "Cancel"],
				cancelId: 1,
			}),
		).toMatchObject({ response: 1 });
		expect(await dialogs.open({})).toMatchObject({ canceled: true });
		expect(await dialogs.save({})).toMatchObject({ canceled: true });
	}
	expect(native.showMessageBox).not.toHaveBeenCalled();
	expect(native.showOpenDialog).not.toHaveBeenCalled();
	expect(native.showSaveDialog).not.toHaveBeenCalled();
});

it("restores and parents prompts, pickers and exports to management", async () => {
	const window = {
		isDestroyed: () => false,
		isMinimized: () => true,
		isVisible: () => false,
		restore: vi.fn(),
		show: vi.fn(),
		focus: vi.fn(),
	};
	const dialogs = maintenanceDialogs(() => window as unknown as BrowserWindow);
	await dialogs.message({ message: "Continue?", cancelId: 0 });
	await dialogs.open({ title: "Import" });
	await dialogs.save({ title: "Export" });
	expect(native.showMessageBox).toHaveBeenCalledWith(
		window,
		expect.objectContaining({ signal: expect.any(AbortSignal), cancelId: 0 }),
	);
	expect(native.showOpenDialog).toHaveBeenCalledWith(window, {
		title: "Import",
	});
	expect(native.showSaveDialog).toHaveBeenCalledWith(window, {
		title: "Export",
	});
	expect(window.restore).toHaveBeenCalledTimes(3);
	expect(window.show).toHaveBeenCalledTimes(3);
	expect(window.focus).toHaveBeenCalledTimes(3);
});
