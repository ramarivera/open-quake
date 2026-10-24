import {
	mkdtemp,
	open,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { replaceBackup } from "./backup-write";

vi.mock("node:fs/promises", async (original) => {
	const fs = await original<typeof import("node:fs/promises")>();
	return { ...fs, open: vi.fn(fs.open), rename: vi.fn(fs.rename) };
});
afterEach(() => vi.restoreAllMocks());

for (const failure of ["none", "file", "directory"] as const) {
	it(`requires file sync then rename then POSIX directory sync: ${failure}`, async () => {
		const fs =
			await vi.importActual<typeof import("node:fs/promises")>(
				"node:fs/promises",
			);
		const root = await mkdtemp(join(tmpdir(), "backup-durability-"));
		const path = join(root, "backup.zip");
		const steps: string[] = [];
		const cause = new Error("synthetic sync failure");
		vi.mocked(open).mockImplementation(async (...args) => {
			const handle = await fs.open(...args);
			const kind = args[0] === root ? "directory" : "file";
			const sync = handle.sync.bind(handle);
			vi.spyOn(handle, "sync").mockImplementation(async () => {
				steps.push(kind);
				if (failure === kind) throw cause;
				await sync();
			});
			const close = handle.close.bind(handle);
			vi.spyOn(handle, "close").mockImplementation(async () => {
				steps.push(`close-${kind}`);
				await close();
			});
			return handle;
		});
		vi.mocked(rename).mockImplementation(async (...args) => {
			steps.push("rename");
			await fs.rename(...args);
		});
		try {
			await writeFile(path, "old archive");
			const operation = replaceBackup(path, Buffer.from("new archive"));
			if (failure === "none") await operation;
			else await expect(operation).rejects.toBe(cause);
			expect(steps).toEqual(
				failure === "file"
					? ["file", "close-file"]
					: ["file", "close-file", "rename", "directory", "close-directory"],
			);
			expect(await readFile(path, "utf8")).toBe(
				failure === "file" ? "old archive" : "new archive",
			);
			expect(await readdir(root)).toEqual(["backup.zip"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}
