import { lstat, open, readFile, unlink } from "node:fs/promises";

/** Cooperating runs share one exclusive lock; never unlink a replacement owner. */
export async function acquireAcceptanceLock(path: string) {
	const handle = await open(path, "wx", 0o600).catch(async (cause: unknown) => {
		if (!hasCode(cause, "EEXIST")) throw cause;
		const contents = await readFile(path, "utf8").catch(
			(readCause: unknown) => {
				if (hasCode(readCause, "ENOENT")) return "";
				throw readCause;
			},
		);
		const holder = /^\d{1,10}$/.test(contents.trim())
			? contents.trim()
			: "unknown";
		throw Object.assign(
			new Error(
				`Native acceptance lock is held (PID ${holder}). Confirm that process is dead before removing ${path}`,
				{ cause },
			),
			{ code: "EEXIST" },
		);
	});
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

function hasCode(cause: unknown, code: string): boolean {
	return (
		typeof cause === "object" &&
		cause !== null &&
		"code" in cause &&
		cause.code === code
	);
}
