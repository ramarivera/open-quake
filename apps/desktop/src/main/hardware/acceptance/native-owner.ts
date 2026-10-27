import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, open, realpath, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { competingOwners } from "./policy.js";

/** A common host-local lock, independent of the selected serial and output directory. */
export const acceptanceScratch =
	"/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-hardware-e2e";

export async function ownNativeDevice(artifacts: string) {
	assert(
		resolve(artifacts).startsWith(`${acceptanceScratch}/`),
		"Artifacts must remain inside hardware E2E scratch",
	);
	await mkdir(acceptanceScratch, { recursive: true, mode: 0o700 });
	await mkdir(artifacts, { recursive: true, mode: 0o700 });
	const directory = await realpath(artifacts);
	assert(
		directory.startsWith(`${await realpath(acceptanceScratch)}/`),
		"Artifacts must remain inside hardware E2E scratch",
	);
	const { stdout } = await promisify(execFile)("ps", ["-axo", "pid=,command="]);
	assert.equal(
		competingOwners(stdout, process.pid).length,
		0,
		"Stop the existing device owner before running native acceptance",
	);
	const path = join(acceptanceScratch, "native-owner.lock");
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(String(process.pid));
	} catch (cause) {
		await handle.close();
		await unlink(path);
		throw cause;
	}
	let closed = false;
	return {
		directory,
		async close() {
			if (closed) return;
			closed = true;
			try {
				await handle.close();
			} finally {
				await unlink(path);
			}
		},
	};
}
