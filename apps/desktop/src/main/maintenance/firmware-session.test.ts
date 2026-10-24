import {
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { idleFirmware } from "../../../../../packages/edge/src/maintenance/contracts.js";
import { firmwareSessionStore } from "./firmware-session";

vi.mock("node:fs/promises", async (original) => {
	const fs = await original<typeof import("node:fs/promises")>();
	return { ...fs, readFile: vi.fn(fs.readFile), rename: vi.fn(fs.rename) };
});
afterEach(() => vi.restoreAllMocks());

it("recovers EACCES, preserves the original bytes and blocks saves until preservation succeeds", async () => {
	const fs =
		await vi.importActual<typeof import("node:fs/promises")>(
			"node:fs/promises",
		);
	const root = await mkdtemp(join(tmpdir(), "session-permissions-"));
	const path = join(root, "firmware-session-v1.json");
	const original = JSON.stringify({
		...idleFirmware,
		reason: "synthetic retained evidence",
	});
	await writeFile(path, original);
	const cause = Object.assign(new Error("/private?token=synthetic-secret"), {
		code: "EACCES",
	});
	vi.mocked(readFile).mockRejectedValueOnce(cause);
	vi.mocked(rename).mockRejectedValueOnce(cause).mockRejectedValueOnce(cause);
	const store = firmwareSessionStore(path);
	try {
		expect(await store.load()).toBeUndefined();
		expect(await fs.readFile(path, "utf8")).toBe(original);
		await expect(store.save(idleFirmware)).rejects.toBe(cause);
		expect(await fs.readFile(path, "utf8")).toBe(original);
		await store.save(idleFirmware);
		const preserved = (await readdir(root)).find((name) =>
			name.includes(".recovery-"),
		);
		if (!preserved) throw new Error("Missing recovery evidence");
		expect(await fs.readFile(join(root, preserved), "utf8")).toBe(original);
		expect(JSON.parse(await fs.readFile(path, "utf8"))).toEqual(idleFirmware);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("preserves schema-invalid JSON rather than silently accepting a corrupt session", async () => {
	const root = await mkdtemp(join(tmpdir(), "session-schema-"));
	const path = join(root, "firmware-session-v1.json");
	await writeFile(path, JSON.stringify({ state: "copying" }));
	try {
		expect(await firmwareSessionStore(path).load()).toBeUndefined();
		expect(await readdir(root)).toEqual([
			expect.stringContaining(".recovery-"),
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
