import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import { AppLibrarySnapshot } from "../../../../../packages/device/src/profiles/app-library.js";
import { appLibraryStore } from "./app-library-store";

it("MGMT-386/391 persists OBS-first defaults once, preserves edits and rejects stale writers", async () => {
	const directory = await mkdtemp(join(tmpdir(), "app-library-"));
	try {
		const path = join(directory, "library.json");
		await writeFile(
			path,
			JSON.stringify({
				version: 1,
				revision: 4,
				groups: [{ subMenu: "obsStudio", children: [] }],
			}),
		);
		const store = appLibraryStore(path);
		const seeded = await Effect.runPromise(store.read());
		expect(seeded.groups.map((group) => group.subMenu)).toEqual([
			"obsStudio",
			"Discord",
			"Premiere Pro",
		]);
		expect(seeded.revision).toBe(5);
		const before = await stat(path);
		const rebooted = await Effect.runPromise(appLibraryStore(path).read());
		expect(rebooted).toEqual(seeded);
		expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
		const groups = seeded.groups.map((group) =>
			group.subMenu === "Discord"
				? {
						...group,
						children: group.children.slice(0, 1).map((key) => ({
							...key,
							config: {
								...key.config,
								title: { ...key.config.title, text: "My mute" },
							},
						})),
					}
				: group,
		);
		await Effect.runPromise(
			store.save(
				5,
				Schema.encodeSync(AppLibrarySnapshot)({ ...seeded, groups }).groups,
			),
		);
		const read = await Effect.runPromise(appLibraryStore(path).read());
		expect(read.groups[1]?.children[0]?.config.title.text).toBe("My mute");
		expect(read.groups[1]?.children).toHaveLength(1);
		const stale = await Effect.runPromise(Effect.either(store.save(5, [])));
		expect(stale._tag === "Left" && stale.left.code).toBe(
			"QUAKE.PROFILE.REVISION_CONFLICT",
		);
		expect(JSON.parse(await readFile(path, "utf8")).revision).toBe(6);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
it("invalid library data fails closed without overwriting storage or exposing its cause", async () => {
	const directory = await mkdtemp(join(tmpdir(), "app-library-"));
	try {
		const path = join(directory, "library.json");
		await writeFile(path, "secret-sentinel");
		const result = await Effect.runPromise(
			Effect.either(appLibraryStore(path).read()),
		);
		expect(result._tag === "Left" && result.left.code).toBe(
			"QUAKE.PROFILE.READ_FAILED",
		);
		if (result._tag === "Left") {
			expect(result.left.originalCause).toBeInstanceOf(Error);
			expect(JSON.stringify(result.left)).not.toContain("secret-sentinel");
		}
		expect(await readFile(path, "utf8")).toBe("secret-sentinel");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
