import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { replaceBackup } from "./backup-write";

it("replaces a confirmed backup atomically and preserves it when replacement is aborted", async () => {
	const directory = await mkdtemp(join(tmpdir(), "oq-backup-replace-"));
	const path = join(directory, "backup.zip");
	try {
		await writeFile(path, "previous");
		await replaceBackup(path, Buffer.from("replacement"));
		expect(await readFile(path, "utf8")).toBe("replacement");
		await expect(
			replaceBackup(path, Buffer.from("aborted"), AbortSignal.abort()),
		).rejects.toBeDefined();
		expect(await readFile(path, "utf8")).toBe("replacement");
		expect(await readdir(directory)).toEqual(["backup.zip"]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
