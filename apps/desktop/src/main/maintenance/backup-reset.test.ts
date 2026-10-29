import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserWindow } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { registerMaintenance } from "./index";

const native = vi.hoisted(() => ({
	app: { getVersion: () => "0.0.0", getPath: () => "" },
	BrowserWindow: class {
		isDestroyed = () => false;
		isMinimized = () => false;
		isVisible = () => true;
		focus = () => {};
		webContents = {
			getURL: () => "https://fixture.invalid",
			executeJavaScript: async () => null,
		};
	},
	dialog: { showMessageBox: vi.fn(), showSaveDialog: vi.fn() },
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
	shell: { showItemInFolder: vi.fn() },
}));
vi.mock("electron", () => native);
vi.mock("./backup-store", () => ({
	exportBackup: async () => Buffer.from("synthetic archive"),
	clearOwnedData: vi.fn(),
}));
vi.mock("node:fs/promises", async (original) => {
	const fs = await original<typeof import("node:fs/promises")>();
	return { ...fs, open: vi.fn(fs.open) };
});
afterEach(() => vi.restoreAllMocks());

for (const stage of ["file", "directory"]) {
	it(`does not clear data after ${stage} sync fails and the fresh failure confirmation is declined`, async () => {
		const real =
			await vi.importActual<typeof import("node:fs/promises")>(
				"node:fs/promises",
			);
		const root = await mkdtemp(join(tmpdir(), "backup-reset-"));
		const backup = join(root, "synthetic.zip");
		await writeFile(backup, "previous archive");
		vi.mocked(open).mockImplementation(async (...args) => {
			const file = await real.open(...args);
			if ((stage === "directory") === (args[0] === root))
				vi.spyOn(file, "sync").mockRejectedValue(
					new Error("synthetic sync failure"),
				);
			return file;
		});
		native.dialog.showSaveDialog.mockResolvedValue({
			canceled: false,
			filePath: backup,
		});
		native.dialog.showMessageBox
			.mockResolvedValueOnce({ response: 1 })
			.mockResolvedValueOnce({ response: 0 });
		const stop = vi.fn(async () => {});
		const exit = vi.fn();
		const window = new BrowserWindow();
		const owner = registerMaintenance({
			root,
			mock: true,
			renderer: "https://fixture.invalid",
			hardware: () => undefined,
			management: () => window,
			stopWriters: stop,
			exit,
		});
		try {
			await owner.ready;
			expect(
				await owner.request({ action: "reset", backup: true }),
			).toMatchObject({ ok: true });
			expect(native.dialog.showMessageBox).toHaveBeenCalledTimes(2);
			expect(JSON.stringify(native.dialog.showMessageBox.mock.calls)).toContain(
				"Backup failed. Continue to clear data and exit?",
			);
			expect(stop).not.toHaveBeenCalled();
			expect(exit).not.toHaveBeenCalled();
			expect(native.shell.showItemInFolder).not.toHaveBeenCalled();
			expect(await readFile(backup, "utf8")).toBe(
				stage === "file" ? "previous archive" : "synthetic archive",
			);
		} finally {
			await owner.dispose();
			await rm(root, { recursive: true, force: true });
		}
	});
}
