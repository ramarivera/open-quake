import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ProfileReadFailed,
	ProfileWriteFailed,
} from "../../../../../packages/device/src/profiles/profile-errors.js";
import { completeEncodedEnvelope } from "../../../../../packages/device/src/profiles/profile-fixtures.js";
import {
	createDesktopProfileStorage,
	profileFileSystem,
} from "./local-profile-storage.js";

let directory: string;
let path: string;
beforeEach(async () => {
	directory = await fs.mkdtemp(join(tmpdir(), "quake-profile-test-"));
	path = join(directory, "profiles.json");
});
afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

describe("desktop atomic profile store", () => {
	it("seeds one named profile/page at revision zero and survives restart without reseeding", async () => {
		const storage = createDesktopProfileStorage(path);
		const seed = await storage.read();
		expect(seed).toMatchObject({
			schemaVersion: 1,
			profiles: [{ name: "My profile", revision: 0, pages: [{ keys: [] }] }],
			activeByDevice: {},
		});
		expect(storage.recoveries).toEqual([{ reason: "seeded" }]);
		const restarted = createDesktopProfileStorage(path);
		expect(await restarted.read()).toEqual(seed);
		expect(restarted.recoveries).toEqual([]);
		expect((await fs.stat(path)).mode & 0o777).toBe(0o600);
	});
	it("persists nested fields and retains the exact previous envelope as backup", async () => {
		const storage = createDesktopProfileStorage(path);
		await storage.read();
		const first = completeEncodedEnvelope(4);
		const second = completeEncodedEnvelope(5);
		await storage.write(first);
		await storage.write(second);
		expect(await createDesktopProfileStorage(path).read()).toEqual(second);
		expect(JSON.parse(await fs.readFile(`${path}.bak`, "utf8"))).toEqual(first);
		expect(await fs.readdir(directory)).toEqual([
			"profiles.json",
			"profiles.json.bak",
		]);
	});
	it.each(["write-primary", "rename-primary", "write-backup", "rename-backup"])(
		"leaves the previous revision readable after %s fails",
		async (operation) => {
			const original = completeEncodedEnvelope(4);
			await createDesktopProfileStorage(path).write(original);
			const cause = Object.assign(
				new Error("token=private /home/private/profile"),
				{ code: "EIO" },
			);
			const fails = (target: string) =>
				target.startsWith(
					operation.endsWith("backup") ? `${path}.bak.` : `${path}.`,
				) &&
				(operation.endsWith("backup") || !target.startsWith(`${path}.bak.`));
			const broken = createDesktopProfileStorage(path, {
				...profileFileSystem,
				writeFile: async (target, contents) => {
					if (operation.startsWith("write") && fails(target)) {
						await fs.writeFile(target, "partial-json");
						throw cause;
					}
					await profileFileSystem.writeFile(target, contents);
				},
				rename: async (from, to) => {
					if (operation.startsWith("rename") && fails(from)) throw cause;
					await profileFileSystem.rename(from, to);
				},
			});
			const failure = await broken
				.write(completeEncodedEnvelope(5))
				.catch((error: unknown) => error);
			expect(failure).toBeInstanceOf(ProfileWriteFailed);
			if (failure instanceof ProfileWriteFailed) {
				expect(failure.originalCause).toBe(cause);
				expect(failure.code).toBe("QUAKE.PROFILE.WRITE_FAILED");
				expect(failure.diagnosticCause.sourceCode).toBe("EIO");
				expect(JSON.stringify(failure)).not.toContain("private");
			}
			expect(await createDesktopProfileStorage(path).read()).toEqual(original);
			expect(
				(await fs.readdir(directory)).some((file) => file.endsWith(".tmp")),
			).toBe(false);
		},
	);
	it("preserves a corrupt primary verbatim and restores a validated backup", async () => {
		const storage = createDesktopProfileStorage(path);
		await storage.write(completeEncodedEnvelope(4));
		await storage.write(completeEncodedEnvelope(5));
		await fs.writeFile(path, "{broken:original");
		const restarted = createDesktopProfileStorage(path);
		expect(await restarted.read()).toEqual(completeEncodedEnvelope(4));
		expect(restarted.recoveries).toEqual([
			{ reason: "invalid-primary" },
			{ reason: "restored-backup" },
		]);
		const corrupt = (await fs.readdir(directory)).find((file) =>
			file.includes(".corrupt."),
		);
		expect(corrupt).toBeDefined();
		expect(
			await fs.readFile(join(directory, corrupt ?? "missing"), "utf8"),
		).toBe("{broken:original");
	});
	it("seeds invalid stores while retaining both the invalid primary and backup", async () => {
		await fs.writeFile(path, JSON.stringify({ schemaVersion: 99 }));
		await fs.writeFile(`${path}.bak`, "broken backup");
		const storage = createDesktopProfileStorage(path);
		expect(await storage.read()).toMatchObject({ profiles: [{ revision: 0 }] });
		expect(storage.recoveries.map((entry) => entry.reason)).toEqual([
			"invalid-primary",
			"invalid-backup",
			"seeded",
		]);
		expect(await fs.readFile(`${path}.bak`, "utf8")).toBe("broken backup");
	});
	it("does not seed on a permission failure or claim a failed commit after successful rename", async () => {
		const cause = Object.assign(new Error("secret-path"), { code: "EACCES" });
		const unavailable = createDesktopProfileStorage(path, {
			...profileFileSystem,
			readFile: async () => {
				throw cause;
			},
		});
		const error = await unavailable.read().catch((error: unknown) => error);
		expect(error).toBeInstanceOf(ProfileReadFailed);
		if (error instanceof ProfileReadFailed)
			expect(error.originalCause).toBe(cause);
		expect(await fs.readdir(directory)).toEqual([]);
		const cleanupFails = createDesktopProfileStorage(path, {
			...profileFileSystem,
			remove: async () => {
				throw cause;
			},
		});
		await expect(
			cleanupFails.write(completeEncodedEnvelope()),
		).resolves.toBeUndefined();
		expect(await createDesktopProfileStorage(path).read()).toEqual(
			completeEncodedEnvelope(),
		);
	});
});
