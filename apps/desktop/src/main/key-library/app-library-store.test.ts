import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import {
	APP_LIBRARY_MAX_BYTES,
	AppLibrarySnapshot,
	defaultAppLibrary,
} from "../../../../../packages/device/src/profiles/app-library.js";
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

const limit = APP_LIBRARY_MAX_BYTES;
function snapshotAtBytes(
	size: number,
	groups = defaultAppLibrary(),
): AppLibrarySnapshot {
	const key = groups[0]?.children[0];
	if (!key) throw new Error("Missing preset fixture");
	const make = (icon: string): AppLibrarySnapshot => ({
		version: 1,
		revision: 2,
		groups: groups.map((group, i) =>
			i
				? group
				: {
						...group,
						children: [
							{ ...key, config: { ...key.config, icon } },
							...group.children.slice(1),
						],
					},
		),
	});
	const overhead = Buffer.byteLength(
		JSON.stringify(Schema.encodeSync(AppLibrarySnapshot)(make(""))),
		"utf8",
	);
	const padding = size - overhead;
	return make("é".repeat(Math.floor(padding / 2)) + "x".repeat(padding % 2));
}
it.each([limit - 1, limit, limit + 1])(
	"MGMT-386 bounds UTF-8 snapshots at %i bytes without losing the previous save",
	async (size) => {
		const directory = await mkdtemp(join(tmpdir(), "app-library-limit-"));
		try {
			const path = join(directory, "library.json"),
				store = appLibraryStore(path);
			const before = await Effect.runPromise(store.read());
			const original = await readFile(path);
			const snapshot = snapshotAtBytes(size);
			const encoded = Schema.encodeSync(AppLibrarySnapshot)(snapshot);
			expect(Buffer.byteLength(JSON.stringify(encoded), "utf8")).toBe(size);
			const result = await Effect.runPromise(
				Effect.either(store.save(before.revision, encoded.groups)),
			);
			if (size > limit) {
				expect(result._tag).toBe("Left");
				if (result._tag !== "Left") throw new Error("Oversized save succeeded");
				expect(result.left).toMatchObject({
					_tag: "AppLibrarySizeLimitExceeded",
					code: "QUAKE.APP_LIBRARY.SIZE_LIMIT_EXCEEDED",
					message:
						"The app library exceeds 8 MiB. Remove some presets or artwork and try again.",
				});
				expect(await readFile(path)).toEqual(original);
				expect(await Effect.runPromise(store.read())).toEqual(before);
				expect(await Effect.runPromise(appLibraryStore(path).read())).toEqual(
					before,
				);
			} else {
				expect(result._tag).toBe("Right");
				expect((await readFile(path)).byteLength).toBe(size);
				expect(await Effect.runPromise(appLibraryStore(path).read())).toEqual(
					snapshot,
				);
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
);
it("MGMT-391 rejects an oversized default migration without replacing the original library", async () => {
	const directory = await mkdtemp(join(tmpdir(), "app-library-migration-"));
	try {
		const path = join(directory, "library.json");
		const snapshot = snapshotAtBytes(limit, defaultAppLibrary().slice(0, 1));
		const original = JSON.stringify(
			Schema.encodeSync(AppLibrarySnapshot)(snapshot),
		);
		await writeFile(path, original);
		const result = await Effect.runPromise(
			Effect.either(appLibraryStore(path).read()),
		);
		expect(result._tag === "Left" && result.left.code).toBe(
			"QUAKE.APP_LIBRARY.SIZE_LIMIT_EXCEEDED",
		);
		expect(await readFile(path, "utf8")).toBe(original);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
it("MGMT-386 checks the byte limit when reading multibyte artwork", async () => {
	const directory = await mkdtemp(join(tmpdir(), "app-library-read-limit-"));
	try {
		const path = join(directory, "library.json");
		const original = JSON.stringify(
			Schema.encodeSync(AppLibrarySnapshot)(snapshotAtBytes(limit + 1)),
		);
		expect(original.length).toBeLessThan(limit);
		await writeFile(path, original);
		const result = await Effect.runPromise(
			Effect.either(appLibraryStore(path).read()),
		);
		expect(result._tag === "Left" && result.left.code).toBe(
			"QUAKE.PROFILE.READ_FAILED",
		);
		expect(await readFile(path, "utf8")).toBe(original);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
