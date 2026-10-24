import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { smokeScratchPaths } from "./smoke-scratch";

it("accepts portable explicitly owned scratch and rejects missing opt-in, escapes, symlinks and userData overlap", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "portable-smoke-")));
	const scratch = join(root, "owned");
	const outside = join(root, "other");
	await mkdir(scratch);
	await mkdir(outside);
	const base = {
		scratch,
		temporary: scratch,
		artifacts: join(scratch, "new", "captures"),
		userData: join(outside, "user-data"),
		home: homedir(),
	};
	try {
		expect(await smokeScratchPaths(base)).toEqual({
			scratch,
			temporary: scratch,
			artifacts: base.artifacts,
		});
		await symlink(outside, join(scratch, "escape"));
		for (const invalid of [
			{ scratch: undefined },
			{ scratch: "." },
			{ scratch: "/" },
			{ temporary: outside },
			{ artifacts: scratch },
			{ artifacts: join(scratch, "..", "other", "captures") },
			{ artifacts: join(scratch, "escape", "captures") },
			{ userData: scratch },
			{ userData: root },
			{ userData: join(scratch, "real-data") },
		])
			await expect(async () =>
				smokeScratchPaths({ ...base, ...invalid }),
			).rejects.toBeDefined();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
