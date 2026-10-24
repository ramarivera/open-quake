import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** The native save dialog already confirmed this destination, including replacement. */
export async function replaceBackup(
	path: string,
	bytes: Uint8Array,
	signal?: AbortSignal,
): Promise<void> {
	const staged = join(
		dirname(path),
		`.${basename(path)}.${randomUUID()}.pending`,
	);
	try {
		signal?.throwIfAborted();
		const file = await open(staged, "wx", 0o600);
		try {
			await file.writeFile(bytes, { signal });
			await file.sync();
		} finally {
			await file.close();
		}
		signal?.throwIfAborted();
		await rename(staged, path);
		if (process.platform !== "win32") {
			const parent = await open(dirname(path), "r");
			try {
				await parent.sync();
			} finally {
				await parent.close();
			}
		}
	} finally {
		await rm(staged, { force: true });
	}
}
