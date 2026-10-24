import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ResetFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { clearOwnedData } from "./backup-store";
import { resetAndExit } from "./reset-exit";

vi.mock("node:fs/promises", async (original) => {
	const actual = await original<typeof import("node:fs/promises")>();
	return { ...actual, rename: vi.fn(actual.rename), rm: vi.fn(actual.rm) };
});

for (const stage of ["stop", "rename", "delete", "report"] as const) {
	it(`retains synthetic reset data and exits on ${stage} failure`, async () => {
		const scratch = await mkdtemp(join(tmpdir(), "reset-exit-"));
		const root = join(scratch, "owned-data");
		await mkdir(root);
		await writeFile(join(root, "retained.txt"), "synthetic-owned-data");
		const cause = new Error("/synthetic/private?token=fixture-secret");
		const calls: string[] = [];
		const messages: string[] = [];
		const exit = vi.fn((code: number) => {
			calls.push(`exit:${code}`);
		});
		if (stage === "rename") vi.mocked(rename).mockRejectedValueOnce(cause);
		if (stage === "delete" || stage === "report")
			vi.mocked(rm).mockRejectedValueOnce(cause);
		try {
			const failure: unknown = await resetAndExit({
				stop: async () => {
					calls.push("stop");
					if (stage === "stop") throw cause;
				},
				clear: async () => {
					calls.push("clear");
					await clearOwnedData(root);
				},
				report: async (message) => {
					calls.push("report");
					messages.push(message);
					if (stage === "report") throw new Error("report failed");
				},
				exit,
			}).catch((cause: unknown) => cause);
			expect(failure).toBeInstanceOf(ResetFailed);
			if (!(failure instanceof ResetFailed))
				throw new Error("Missing reset identity");
			expect(failure.originalCause).toBe(cause);
			expect(messages).toHaveLength(1);
			expect(messages[0]).toContain("QUAKE.SETTINGS.RESET_FAILED");
			expect(messages[0]).not.toMatch(/fixture-secret|synthetic\/private/);
			expect(JSON.stringify(failure)).not.toMatch(
				/fixture-secret|synthetic\/private/,
			);
			expect(await readFile(join(root, "retained.txt"), "utf8")).toBe(
				"synthetic-owned-data",
			);
			expect(calls).toEqual(
				stage === "stop"
					? ["stop", "report", "exit:1"]
					: ["stop", "clear", "report", "exit:1"],
			);
			expect(exit).toHaveBeenCalledExactlyOnceWith(1);
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	});
}

it("awaits writer shutdown before clearing and exits successfully", async () => {
	const calls: string[] = [];
	let release = () => {};
	const stopped = new Promise<void>((resolve) => {
		release = resolve;
	});
	const work = resetAndExit({
		stop: () => stopped,
		clear: async () => {
			calls.push("clear");
		},
		report: async () => {
			calls.push("report");
		},
		exit: (code) => {
			calls.push(`exit:${code}`);
		},
	});
	await Promise.resolve();
	expect(calls).toEqual([]);
	release();
	await work;
	expect(calls).toEqual(["clear", "exit:0"]);
});
