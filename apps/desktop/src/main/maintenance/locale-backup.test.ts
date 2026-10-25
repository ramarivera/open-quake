import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { stripFixtureEnvelope } from "../test/strip-fixtures";
import { readBackup, writeBackup } from "./backup-archive";
import { exportBackup, prepareRestore } from "./backup-store";

it("preserves the saved language through export and restore and rejects corrupt settings before writes", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-locale-backup-"));
	const source = join(root, "source");
	const target = join(root, "target");
	const saved = {
		version: 1,
		locale: "de",
		revision: 7,
		future: { enabled: true },
	};
	try {
		for (const directory of [source, target]) {
			await mkdir(directory);
			await writeFile(
				join(directory, "profiles-v1.json"),
				JSON.stringify(stripFixtureEnvelope()),
			);
		}
		await writeFile(join(source, "settings-v1.json"), JSON.stringify(saved));
		const archive = await exportBackup(source);
		const files = await readBackup(
			archive,
			"DK-Suite_default_date.zip",
			"default",
		);
		expect(
			JSON.parse(
				Buffer.from(files.get("open-quake/settings-v1.json") ?? []).toString(),
			),
		).toEqual(saved);
		const plan = await prepareRestore(archive, "DK-Suite_default_date.zip");
		await plan.validate(target);
		await plan.commit(target);
		expect(
			JSON.parse(await readFile(join(target, "settings-v1.json"), "utf8")),
		).toEqual(saved);
		for (const invalid of [
			{ ...saved, locale: "xx" },
			{ ...saved, version: 2 },
			{ ...saved, revision: -1 },
		]) {
			files.set(
				"open-quake/settings-v1.json",
				Buffer.from(JSON.stringify(invalid)),
			);
			const corrupt = await writeBackup(files, "default");
			await expect(
				prepareRestore(corrupt, "DK-Suite_default_date.zip"),
			).rejects.toBeDefined();
			expect(
				JSON.parse(await readFile(join(target, "settings-v1.json"), "utf8")),
			).toEqual(saved);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
