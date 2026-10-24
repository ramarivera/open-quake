import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Schema } from "effect";

export async function privateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	if (!(await lstat(path)).isDirectory())
		throw new Error("Invalid meeting directory");
	await chmod(path, 0o700);
}
export async function meetingDirectory(
	root: string,
	id: string,
): Promise<string> {
	if (!Schema.is(Schema.UUID)(id)) throw new Error("Invalid meeting ID");
	await privateDirectory(root);
	const directory = join(root, id);
	await privateDirectory(directory);
	return directory;
}
/** Never follows an existing output symlink; permissions precede content writes. */
export async function privateOutput(path: string): Promise<void> {
	const file = await open(
		path,
		constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await file.chmod(0o600);
		await file.truncate(0);
	} finally {
		await file.close();
	}
}
/** Replace the directory entry, including an existing symlink, with a private file. */
export async function writePrivateFile(
	path: string,
	text: string,
): Promise<void> {
	const staging = join(
		dirname(path),
		`.meeting-${crypto.randomUUID()}.staging`,
	);
	try {
		const file = await open(staging, "wx", 0o600);
		try {
			await file.writeFile(text, "utf8");
		} finally {
			await file.close();
		}
		await rename(staging, path);
	} finally {
		await rm(staging, { force: true });
	}
}
