import { lstat, open, unlink } from "node:fs/promises";

/** Cooperating runs share one exclusive lock; never unlink a replacement owner. */
export async function acquireAcceptanceLock(path: string) {
	const handle = await open(path, "wx", 0o600);
	const identity = await handle.stat();
	let closed = false;
	async function close() {
		if (closed) return;
		closed = true;
		try {
			const current = await lstat(path).catch((cause: unknown) => {
				if (
					typeof cause === "object" &&
					cause &&
					"code" in cause &&
					cause.code === "ENOENT"
				)
					return undefined;
				throw cause;
			});
			if (current?.dev === identity.dev && current.ino === identity.ino)
				await unlink(path);
		} finally {
			await handle.close();
		}
	}
	try {
		await handle.writeFile(String(process.pid));
	} catch (cause) {
		await close();
		throw cause;
	}
	return { close };
}
