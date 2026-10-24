import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
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
		await writeFile(staged, bytes, { flag: "wx", mode: 0o600, signal });
		signal?.throwIfAborted();
		await rename(staged, path);
	} finally {
		await rm(staged, { force: true });
	}
}
