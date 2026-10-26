import * as filesystem from "node:fs/promises";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Option, Schema } from "effect";
import { nativeImage } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	builtinProfiles,
	translateProfile,
} from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	Profile,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileThumbnailFailed } from "../../../../../packages/device/src/profiles/profile-errors.js";
import { ProfileLocale } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { profileThumbnailKey } from "./profile-thumbnail-key";
import { createProfileThumbnailStore } from "./profile-thumbnails";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		open: vi.fn(actual.open),
		rename: vi.fn(actual.rename),
		lstat: vi.fn(actual.lstat),
	};
});
vi.mock("./profile-thumbnail-key", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./profile-thumbnail-key")>();
	return { ...actual, profileThumbnailKey: vi.fn(actual.profileThumbnailKey) };
});
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlYAAAAAASUVORK5CYII=",
	"base64",
);
vi.mock("electron", () => ({
	nativeImage: {
		createFromBuffer: vi.fn((bytes: Buffer) => ({
			getSize: () => ({ width: 1, height: 1 }),
			isEmpty: () => bytes.length < 60,
		})),
	},
}));
const profile = Schema.decodeUnknownSync(ProfileEnvelope)({
	schemaVersion: 1,
	profiles: [
		{
			id: "private-profile",
			name: "Fixture",
			revision: 0,
			pages: [{ id: "page", keys: [] }],
		},
	],
	activeByDevice: {},
}).profiles[0];
const directories: string[] = [];
async function directory() {
	const dir = await mkdtemp(
		join(process.env.OPEN_QUAKE_TEST_SCRATCH ?? tmpdir(), "thumbnails-"),
	);
	directories.push(dir);
	return dir;
}
afterEach(async () => {
	for (const dir of directories.splice(0))
		await rm(dir, { recursive: true, force: true });
});
describe("canonical profile thumbnail storage", () => {
	it("separates saved border variants and retains both across pruning", async () => {
		const root = await directory();
		const store = createProfileThumbnailStore(root);
		const data = await store.write(profile, "en", png, true);
		expect(Option.isNone(await store.read(profile, "en", false))).toBe(true);
		await store.write(profile, "en", png, false);
		await store.prune([profile]);
		expect(Option.getOrUndefined(await store.read(profile, "en", true))).toBe(
			data,
		);
		expect(Option.getOrUndefined(await store.read(profile, "en", false))).toBe(
			data,
		);
		expect(await readdir(join(root, "thumbnails"))).toHaveLength(2);
	});
	it("atomically publishes content/locale keys and never reuses stale same-revision content", async () => {
		const root = await directory();
		const store = createProfileThumbnailStore(root);
		expect(Option.isNone(await store.read(profile, "en"))).toBe(true);
		const data = await store.write(profile, "en", png);
		expect(Option.getOrUndefined(await store.read(profile, "en"))).toBe(data);
		expect(
			await readFile(
				join(root, "thumbnails", `${profileThumbnailKey(profile, "en")}.png`),
			),
		).toEqual(png);
		expect(await readdir(join(root, "thumbnails"))).toEqual([
			`${profileThumbnailKey(profile, "en")}.png`,
		]);
		expect(Option.isNone(await store.read(profile, "de"))).toBe(true);
		expect(
			Option.isNone(await store.read({ ...profile, name: "Edited" }, "en")),
		).toBe(true);
		expect(
			Option.isNone(await store.read({ ...profile, revision: 1 }, "en")),
		).toBe(true);
	});
	it("keeps an existing valid capture when a malformed replacement fails", async () => {
		const root = await directory();
		const store = createProfileThumbnailStore(root);
		const data = await store.write(profile, "en", png);
		await expect(
			store.write(profile, "en", png.subarray(0, 8)),
		).rejects.toBeInstanceOf(ProfileThumbnailFailed);
		expect(Option.getOrUndefined(await store.read(profile, "en"))).toBe(data);
		expect(await readdir(join(root, "thumbnails"))).toHaveLength(1);
	});
	it("treats corrupt and oversized cached bytes as misses before native decode", async () => {
		const root = await directory();
		await mkdir(join(root, "thumbnails"));
		const path = join(
			root,
			"thumbnails",
			`${profileThumbnailKey(profile, "en")}.png`,
		);
		const huge = Buffer.from(png);
		huge.writeUInt32BE(100_000, 16);
		huge.writeUInt32BE(100_000, 20);
		for (const bytes of [Buffer.alloc(1_000_001), png.subarray(0, 8), huge]) {
			await writeFile(path, bytes);
			expect(
				Option.isNone(
					await createProfileThumbnailStore(root).read(profile, "en"),
				),
			).toBe(true);
		}
		expect(nativeImage.createFromBuffer).not.toHaveBeenCalled();
	});
	it("does not delete a valid concurrent capture when an open corrupt inode finishes reading", async () => {
		const root = await directory();
		const store = createProfileThumbnailStore(root);
		await mkdir(join(root, "thumbnails"));
		const path = join(
			root,
			"thumbnails",
			`${profileThumbnailKey(profile, "en")}.png`,
		);
		await writeFile(path, png.subarray(0, 8));
		let opened: () => void = () => {},
			release: () => void = () => {};
		const entered = new Promise<void>((resolve) => {
			opened = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { open } =
			await vi.importActual<typeof import("node:fs/promises")>(
				"node:fs/promises",
			);
		const spy = vi
			.spyOn(filesystem, "open")
			.mockImplementationOnce(async (...args) => {
				const file = await open(...args);
				opened();
				await gate;
				return file;
			});
		try {
			const reading = store.read(profile, "en");
			await entered;
			const data = await store.write(profile, "en", png);
			release();
			expect(Option.isNone(await reading)).toBe(true);
			expect(Option.getOrUndefined(await store.read(profile, "en"))).toBe(data);
		} finally {
			release();
			spy.mockRestore();
		}
	});
	it("treats native decoding rejection as a miss while malformed writes stay typed", async () => {
		const root = await directory();
		const store = createProfileThumbnailStore(root);
		await store.write(profile, "en", png);
		vi.mocked(nativeImage.createFromBuffer).mockImplementationOnce(() => {
			throw new RangeError("bad native image");
		});
		expect(Option.isNone(await store.read(profile, "en"))).toBe(true);
		expect(Option.isSome(await store.read(profile, "en"))).toBe(true);
	});
	it("keeps genuine filesystem failures typed with retained scrubbed causes", async () => {
		const root = await directory();
		await mkdir(
			join(root, "thumbnails", `${profileThumbnailKey(profile, "en")}.png`),
			{ recursive: true },
		);
		const error: unknown = await createProfileThumbnailStore(root)
			.read(profile, "en")
			.catch((cause) => cause);
		expect(error).toBeInstanceOf(ProfileThumbnailFailed);
		if (error instanceof ProfileThumbnailFailed) {
			expect(error.originalCause).toMatchObject({ code: "EISDIR" });
			expect(error.code).toBe("QUAKE.PROFILE.THUMBNAIL_FAILED");
			expect(JSON.stringify(error)).not.toMatch(
				/private-profile|SCRATCHPADS_FOR_AGENTS/,
			);
		}
	});
	it("does not translate and hash the full catalog when no owned PNG exists", async () => {
		const root = await directory();
		const store = createProfileThumbnailStore(root);
		const profiles = builtinProfiles("linux");
		vi.mocked(profileThumbnailKey).mockClear();
		await store.prune(profiles);
		const cache = join(root, "thumbnails");
		await mkdir(cache);
		await writeFile(join(cache, "notes.txt"), "keep");
		await store.prune(profiles);
		expect(profileThumbnailKey).not.toHaveBeenCalled();
	});

	it("reuses unchanged locale keys across snapshots without trusting revision or object identity", async () => {
		const root = await directory();
		const store = createProfileThumbnailStore(root);
		const current = builtinProfiles("darwin")[0];
		if (!current) throw new Error("Missing built-in fixture");
		const retained = translateProfile(current, "de");
		await store.write(retained, "de", png);
		await store.prune([current]);
		vi.mocked(profileThumbnailKey).mockClear();
		const orphan = `${"d".repeat(64)}.png`;
		await writeFile(join(root, "thumbnails", orphan), png);
		// Repository snapshots detach trees even when only selection changed.
		await store.prune([
			Schema.decodeUnknownSync(Schema.typeSchema(Profile))(current),
		]);
		expect(profileThumbnailKey).not.toHaveBeenCalled();
		expect(await readdir(join(root, "thumbnails"))).not.toContain(orphan);
		expect(Option.isSome(await store.read(retained, "de"))).toBe(true);
		// A content edit with the same id/revision must invalidate cached names.
		await store.prune([
			{
				...current,
				compatibility: Option.some({
					...Option.getOrElse(current.compatibility, () => ({})),
					cacheTest: "changed",
				}),
			},
		]);
		expect(Option.isNone(await store.read(retained, "de"))).toBe(true);
	});

	it("prunes obsolete owned files while preserving every live locale and unrelated entries", async () => {
		const root = await directory();
		const store = createProfileThumbnailStore(root);
		const current = builtinProfiles("darwin")[0];
		if (!current) throw new Error("Missing built-in fixture");
		const live: string[] = [];
		for (const locale of ProfileLocale.literals) {
			const localized = translateProfile(current, locale);
			await store.write(localized, locale, png);
			live.push(`${profileThumbnailKey(localized, locale)}.png`);
		}
		const cache = join(root, "thumbnails");
		const obsolete = `${"a".repeat(64)}.png`;
		const oldPending = `${obsolete}.12345678-1234-4123-8123-123456789abc.pending`;
		const freshPending = `${obsolete}.12345678-1234-4123-8123-123456789abd.pending`;
		for (const name of [
			obsolete,
			oldPending,
			freshPending,
			"notes.txt",
			"foreign.pending",
		])
			await writeFile(join(cache, name), "private-sentinel");
		await utimes(join(cache, oldPending), new Date(0), new Date(0));
		const directoryName = `${"b".repeat(64)}.png`;
		await mkdir(join(cache, directoryName));
		const link = `${"c".repeat(64)}.png`;
		await symlink(join(cache, "notes.txt"), join(cache, link));
		await store.prune([current]);
		expect((await readdir(cache)).sort()).toEqual(
			[
				...live,
				freshPending,
				"notes.txt",
				"foreign.pending",
				directoryName,
				link,
			].sort(),
		);
		expect(await readFile(join(cache, "notes.txt"), "utf8")).toBe(
			"private-sentinel",
		);
	});
	it("serializes cleanup with atomic publication and keeps real filesystem causes", async () => {
		const root = await directory();
		const store = createProfileThumbnailStore(root);
		let entered: () => void = () => {},
			release: () => void = () => {};
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const original =
			await vi.importActual<typeof import("node:fs/promises")>(
				"node:fs/promises",
			);
		vi.mocked(filesystem.lstat).mockClear();
		const rename = vi
			.spyOn(filesystem, "rename")
			.mockImplementationOnce(async (...args) => {
				entered();
				await gate;
				return original.rename(...args);
			});
		try {
			const writing = store.write(profile, "en", png);
			await started;
			const pruning = store.prune([]);
			await Promise.resolve();
			expect(filesystem.lstat).not.toHaveBeenCalled();
			release();
			await Promise.all([writing, pruning]);
			expect(Option.isNone(await store.read(profile, "en"))).toBe(true);
			expect(await readdir(join(root, "thumbnails"))).toEqual([]);
		} finally {
			release();
			rename.mockRestore();
		}
		await rm(join(root, "thumbnails"), { recursive: true });
		await writeFile(join(root, "thumbnails"), "not a directory");
		const error: unknown = await store.prune([]).catch((cause) => cause);
		expect(error).toBeInstanceOf(ProfileThumbnailFailed);
		if (error instanceof ProfileThumbnailFailed) {
			expect(error.originalCause).toMatchObject({ code: "ENOTDIR" });
			expect(JSON.stringify(error)).not.toContain(root);
		}
	});
	it("does not traverse a replaced cache directory and retries after a typed sweep failure", async () => {
		const root = await directory();
		const external = await directory();
		const file = `${"a".repeat(64)}.png`;
		await writeFile(join(external, file), png);
		await symlink(external, join(root, "thumbnails"));
		const store = createProfileThumbnailStore(root);
		await store.prune([]);
		expect(await readFile(join(external, file))).toEqual(png);
		await rm(join(root, "thumbnails"));
		await writeFile(join(root, "thumbnails"), "not a directory");
		await expect(store.prune([])).rejects.toBeInstanceOf(
			ProfileThumbnailFailed,
		);
		await rm(join(root, "thumbnails"));
		await store.prune([]);
		await store.write(profile, "en", png);
		expect(Option.isSome(await store.read(profile, "en"))).toBe(true);
	});
});
