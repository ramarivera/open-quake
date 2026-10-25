import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Option, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileThumbnailFailed } from "../../../../../packages/device/src/profiles/profile-errors.js";
import { profileThumbnailKey } from "./profile-thumbnail-key";
import { createProfileThumbnailStore } from "./profile-thumbnails";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlYAAAAAASUVORK5CYII=",
	"base64",
);
vi.mock("electron", () => ({
	nativeImage: {
		createFromBuffer: (bytes: Buffer) => ({
			getSize: () => ({ width: 1, height: 1 }),
			isEmpty: () => bytes.length < 60,
		}),
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
	it("rejects oversized and undecodable files with scrubbed retained source causes", async () => {
		const root = await directory();
		await mkdir(join(root, "thumbnails"));
		const path = join(
			root,
			"thumbnails",
			`${profileThumbnailKey(profile, "en")}.png`,
		);
		for (const bytes of [Buffer.alloc(1_000_001), png.subarray(0, 8)]) {
			await writeFile(path, bytes);
			const error: unknown = await createProfileThumbnailStore(root)
				.read(profile, "en")
				.catch((cause) => cause);
			expect(error).toBeInstanceOf(ProfileThumbnailFailed);
			if (error instanceof ProfileThumbnailFailed) {
				expect(error.originalCause).toBeInstanceOf(RangeError);
				expect(JSON.stringify(error)).not.toMatch(
					/private-profile|SCRATCHPADS_FOR_AGENTS/,
				);
			}
		}
	});
});
