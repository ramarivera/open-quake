import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserWindow } from "electron";
import { expect, it, vi } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { registerMaintenance } from "./index";

const native = vi.hoisted(() => ({
	app: { getVersion: () => "0.0.0", getPath: () => "" },
	BrowserWindow: class {
		isDestroyed = () => false;
		webContents = {
			getURL: () => "https://fixture.invalid",
			executeJavaScript: async () => null,
		};
	},
	dialog: { showSaveDialog: vi.fn() },
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
	shell: { showItemInFolder: vi.fn() },
}));
vi.mock("electron", () => native);
vi.mock("./backup-archive", async (original) => {
	const actual = await original<typeof import("./backup-archive")>();
	return { ...actual, backupLimits: { ...actual.backupLimits, total: 1 } };
});
it("returns only the catalog BackupFailed reply through actual maintenance export on a read-budget failure", async () => {
	const root = await mkdtemp(join(tmpdir(), "export-budget-ipc-"));
	await writeFile(
		join(root, "profiles-v1.json"),
		JSON.stringify(encodeProfileEnvelope(createInitialProfileEnvelope())),
	);
	native.dialog.showSaveDialog.mockResolvedValue({
		canceled: false,
		filePath: join(root, "backup.zip"),
	});
	const window = new BrowserWindow();
	const owner = registerMaintenance({
		root,
		mock: true,
		renderer: "https://fixture.invalid",
		hardware: () => undefined,
		management: () => window,
		stopWriters: async () => {},
	});
	try {
		await owner.ready;
		expect(await owner.request({ action: "export" })).toEqual({
			ok: false,
			code: "QUAKE.BACKUP.FAILED",
		});
		expect(native.shell.showItemInFolder).not.toHaveBeenCalled();
	} finally {
		await owner.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
