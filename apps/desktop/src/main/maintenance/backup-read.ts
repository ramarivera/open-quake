import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { BackupFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import type { BackupReadBudget } from "./backup-budget";

/** Stable no-follow descriptor reads, with pre-allocation accounting and at most one growth-detection byte. */
export async function readBackupFile(
	path: string,
	budget: BackupReadBudget,
	signal?: AbortSignal,
	retainedCheck?: (size: number) => void,
): Promise<Uint8Array> {
	if (!isAbsolute(path)) throw new BackupFailed();
	const selected = await lstat(path);
	if (!selected.isFile()) throw new BackupFailed();
	budget.check(selected.size);
	retainedCheck?.(selected.size);
	let current = resolve(path);
	while (true) {
		const info = await lstat(current);
		if (info.isSymbolicLink()) throw new BackupFailed();
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	const file = await open(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const before = await file.stat();
		if (
			!before.isFile() ||
			before.dev !== selected.dev ||
			before.ino !== selected.ino
		)
			throw new BackupFailed();
		retainedCheck?.(before.size);
		budget.reserve(before.size);
		signal?.throwIfAborted();
		const bytes = Buffer.alloc(before.size + 1);
		let length = 0;
		while (length < bytes.length) {
			signal?.throwIfAborted();
			const chunk = await file.read(bytes, length, bytes.length - length, null);
			if (!chunk.bytesRead) break;
			length += chunk.bytesRead;
		}
		const after = await file.stat();
		if (
			length !== before.size ||
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			before.ctimeMs !== after.ctimeMs
		)
			throw new BackupFailed();
		return bytes.subarray(0, length);
	} finally {
		await file.close();
	}
}
