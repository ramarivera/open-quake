import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { afterEach, expect, it } from "vitest";
import { audioFiles } from "./audio-files";
import { privateOutput, writePrivateFile } from "./private-files";

const roots: string[] = [];
const setup = async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-meeting-private-"));
	roots.push(root);
	return root;
};
afterEach(async () => {
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true });
});
it("replaces readable exports with mode 0600 and never writes through a destination symlink", async () => {
	const root = await setup(),
		destination = join(root, "minutes.md"),
		target = join(root, "unrelated.txt");
	await writeFile(destination, "old");
	await chmod(destination, 0o644);
	await writePrivateFile(destination, "private summary");
	expect((await stat(destination)).mode & 0o777).toBe(0o600);
	expect(await readFile(destination, "utf8")).toBe("private summary");
	await rm(destination);
	await writeFile(target, "preserved");
	await symlink(target, destination);
	await writePrivateFile(destination, "private replacement");
	expect((await lstat(destination)).isSymbolicLink()).toBe(false);
	expect(await readFile(target, "utf8")).toBe("preserved");
});
it("prepares private converter outputs and rejects output symlinks", async () => {
	const root = await setup(),
		output = join(root, "merged_0.mp3"),
		target = join(root, "other.mp3");
	await writeFile(output, "old");
	await chmod(output, 0o644);
	await privateOutput(output);
	expect((await stat(output)).mode & 0o777).toBe(0o600);
	await rm(output);
	await writeFile(target, "preserved");
	await symlink(target, output);
	await expect(privateOutput(output)).rejects.toThrow();
	expect(await readFile(target, "utf8")).toBe("preserved");
});
it("rejects traversal IDs and symlinked recording directories before audio writes", async () => {
	const root = await setup(),
		outside = join(root, "outside"),
		managed = join(root, "managed"),
		id = crypto.randomUUID();
	await mkdir(outside);
	await mkdir(managed);
	await symlink(outside, join(managed, id));
	const files = audioFiles(managed, "must-not-run");
	for (const attempted of [id, "../outside"]) {
		const result = await Effect.runPromise(
			Effect.either(
				files.write({
					id: attempted,
					track: "mic",
					segment: 0,
					bytes: new Uint8Array([1]),
				}),
			),
		);
		expect(Either.isLeft(result) && result.left.code).toBe(
			"QUAKE.MEETING.STORAGE_FAILED",
		);
	}
	await expect(stat(join(outside, "mic_0.webm"))).rejects.toThrow();
});
