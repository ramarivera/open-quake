import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	defaultCaption,
	type EmojiStore,
	emptyEmojiStore,
} from "../../../../../packages/edge/src/emoji/emoji-contracts";
import {
	EmojiRepository,
	emojiStorageLayer,
} from "../../../../../packages/edge/src/emoji/emoji-repository";
import { tinyFixture } from "../../shared/gif/fixtures";
import { emojiFiles } from "./files";

vi.mock("node:fs/promises", async (load) => {
	const actual = await load<typeof import("node:fs/promises")>();
	return {
		...actual,
		readFile: vi.fn(actual.readFile),
		writeFile: vi.fn(actual.writeFile),
		rename: vi.fn(actual.rename),
		link: vi.fn(actual.link),
		rm: vi.fn(actual.rm),
	};
});
const realFs =
	await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const gif = Buffer.from(tinyFixture, "base64");
const hash = createHash("sha256").update(gif).digest("hex");
const saved = (revision: number): EmojiStore => ({
	...emptyEmojiStore,
	revision,
	items: [
		{
			id: "one",
			name: "Cat",
			original: hash,
			rendered: hash,
			caption: defaultCaption,
		},
	],
	packages: [{ id: "pack", name: "Cats", emojiIds: ["one"], profileId: null }],
});
let directory: string;
let root: string;
let primary: string;
let backup: string;
beforeEach(async () => {
	vi.mocked(fs.readFile).mockImplementation(realFs.readFile);
	vi.mocked(fs.writeFile).mockImplementation(realFs.writeFile);
	vi.mocked(fs.rename).mockImplementation(realFs.rename);
	vi.mocked(fs.link).mockImplementation(realFs.link);
	vi.mocked(fs.rm).mockImplementation(realFs.rm);
	vi.clearAllMocks();
	directory = await realFs.mkdtemp(join(tmpdir(), "open-quake-emoji-files-"));
	root = join(directory, "emoji");
	await realFs.mkdir(root);
	primary = join(root, "library.json");
	backup = join(root, "library.backup.json");
});
afterEach(async () => {
	await realFs.rm(directory, { recursive: true, force: true });
});

describe("emoji library files and repository consumer", () => {
	it("returns null only for a new library and prefers a valid primary", async () => {
		expect(await emojiFiles(root).read()).toBeNull();
		await realFs.writeFile(primary, JSON.stringify(saved(3)));
		await realFs.writeFile(backup, JSON.stringify(saved(9)));
		expect(await emojiFiles(root).read()).toEqual(saved(3));
	});
	it.each([
		"{",
		"null",
		JSON.stringify({ version: 99 }),
		JSON.stringify({ ...emptyEmojiStore, revision: -1 }),
		JSON.stringify({ ...emptyEmojiStore, unexpected: "private" }),
	])(
		"recovers a malformed/schema-invalid primary without rotating it over the valid backup: %s",
		async (invalid) => {
			const previous = JSON.stringify(saved(4), null, 2);
			await realFs.writeFile(primary, invalid);
			await realFs.writeFile(backup, previous);
			const files = emojiFiles(root);
			expect(await files.read()).toEqual(saved(4));
			expect(await realFs.readFile(primary, "utf8")).toBe(invalid);
			await files.write(saved(5));
			expect(await realFs.readFile(backup, "utf8")).toBe(previous);
			expect(await emojiFiles(root).read()).toEqual(saved(5));
			await files.write(saved(6));
			expect(JSON.parse(await realFs.readFile(backup, "utf8"))).toEqual(
				saved(5),
			);
			expect(await realFs.readdir(root)).toEqual([
				"library.backup.json",
				"library.json",
			]);
		},
	);
	it("uses a valid backup when the primary is absent and preserves it on the next write", async () => {
		await realFs.writeFile(backup, JSON.stringify(saved(4)));
		const files = emojiFiles(root);
		expect(await files.read()).toEqual(saved(4));
		await files.write(saved(5));
		expect(JSON.parse(await realFs.readFile(backup, "utf8"))).toEqual(saved(4));
	});
	it("never replaces a valid backup from invalid bytes even when write happens before read", async () => {
		await realFs.writeFile(primary, JSON.stringify({ version: 1 }));
		await realFs.writeFile(backup, JSON.stringify(saved(3)));
		await emojiFiles(root).write(saved(4));
		expect(JSON.parse(await realFs.readFile(backup, "utf8"))).toEqual(saved(3));
	});
	it("fails when no valid recovery exists rather than seeding over saved files", async () => {
		await realFs.writeFile(primary, "{");
		await realFs.writeFile(
			backup,
			JSON.stringify({ ...emptyEmojiStore, revision: -1 }),
		);
		await expect(emojiFiles(root).read()).rejects.toBeInstanceOf(SyntaxError);
		expect(await realFs.readFile(primary, "utf8")).toBe("{");
		await realFs.rm(primary);
		await expect(emojiFiles(root).read()).rejects.toMatchObject({
			_tag: "ParseError",
		});
	});
	it("rejects schema-invalid writes before changing the primary or backup", async () => {
		const files = emojiFiles(root);
		await files.write(saved(1));
		await files.write(saved(2));
		const primaryBefore = await realFs.readFile(primary, "utf8");
		const backupBefore = await realFs.readFile(backup, "utf8");
		await expect(
			files.write({ ...saved(3), revision: 1.5 }),
		).rejects.toMatchObject({ _tag: "ParseError" });
		expect(await realFs.readFile(primary, "utf8")).toBe(primaryBefore);
		expect(await realFs.readFile(backup, "utf8")).toBe(backupBefore);
	});
	it.each(["write-primary", "write-backup", "rename-primary", "rename-backup"])(
		"keeps the previous library and assets readable if %s fails",
		async (operation) => {
			const files = emojiFiles(root);
			await files.put(gif);
			await files.write(saved(1));
			const cause = Object.assign(new Error("private diagnostic"), {
				code: "EIO",
			});
			vi.mocked(fs.writeFile).mockImplementation(
				async (path, contents, options) => {
					if (
						operation.startsWith("write") &&
						String(path).endsWith(".backup") === operation.endsWith("backup")
					) {
						await realFs.writeFile(path, "partial", options);
						throw cause;
					}
					await realFs.writeFile(path, contents, options);
				},
			);
			vi.mocked(fs.rename).mockImplementation(async (from, to) => {
				if (
					operation.startsWith("rename") &&
					(String(to) === backup) === operation.endsWith("backup")
				)
					throw cause;
				await realFs.rename(from, to);
			});
			await expect(files.write(saved(2))).rejects.toBe(cause);
			expect(await files.read()).toEqual(saved(1));
			expect(await files.get(hash)).toEqual(gif);
			expect(
				(await realFs.readdir(root)).filter((name) => name.includes(".part")),
			).toEqual([]);
		},
	);
	it("does not hide read permission failures behind a valid backup", async () => {
		await realFs.writeFile(backup, JSON.stringify(saved(1)));
		const cause = Object.assign(new Error("private"), { code: "EACCES" });
		vi.mocked(fs.readFile).mockRejectedValueOnce(cause);
		await expect(emojiFiles(root).read()).rejects.toBe(cause);
		expect(fs.readFile).toHaveBeenCalledTimes(1);
	});
	it("does not turn a committed rename into a failed save if cleanup fails", async () => {
		vi.mocked(fs.rm).mockRejectedValueOnce(
			Object.assign(new Error("cleanup"), { code: "EACCES" }),
		);
		await expect(emojiFiles(root).write(saved(2))).resolves.toBeUndefined();
		expect(await emojiFiles(root).read()).toEqual(saved(2));
		expect((await realFs.stat(primary)).mode & 0o777).toBe(0o600);
	});
	it("drives backup recovery and a subsequent transaction through the actual Effect repository", async () => {
		await realFs.writeFile(primary, JSON.stringify({ version: 1 }));
		await realFs.writeFile(backup, JSON.stringify(saved(4)));
		const files = emojiFiles(root);
		await files.put(gif);
		const layer = EmojiRepository.Default.pipe(
			Layer.provide(emojiStorageLayer(files)),
		);
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const repository = yield* EmojiRepository;
				expect(yield* repository.read()).toEqual(saved(4));
				return yield* repository.transact((state) =>
					Effect.succeed({ ...state, revision: state.revision + 1 }),
				);
			}).pipe(Effect.provide(layer)),
		);
		expect(result).toEqual(saved(5));
		expect(await emojiFiles(root).read()).toEqual(saved(5));
		expect(JSON.parse(await realFs.readFile(backup, "utf8"))).toEqual(saved(4));
		expect(await files.get(hash)).toEqual(gif);
	});
});

describe("immutable content-addressed emoji assets", () => {
	it("deduplicates without overwriting an existing asset or changing its metadata", async () => {
		const files = emojiFiles(root);
		expect(await files.put(gif)).toBe(hash);
		const before = await realFs.stat(files.assetPath(hash));
		vi.clearAllMocks();
		expect(await files.put(gif)).toBe(hash);
		const after = await realFs.stat(files.assetPath(hash));
		expect([after.ino, after.mtimeMs, after.size]).toEqual([
			before.ino,
			before.mtimeMs,
			before.size,
		]);
		expect(after.mode & 0o777).toBe(0o600);
		expect(
			vi
				.mocked(fs.writeFile)
				.mock.calls.every(
					([target]) => String(target) !== files.assetPath(hash),
				),
		).toBe(true);
		expect(await files.get(hash)).toEqual(gif);
		expect(await realFs.readdir(join(root, "assets"))).toEqual([hash]);
	});
	it("publishes identical concurrent imports once with no partial assets or staging files", async () => {
		const files = emojiFiles(root);
		const results = await Promise.all(
			Array.from({ length: 12 }, () => files.put(gif)),
		);
		expect(results).toEqual(Array(12).fill(hash));
		expect(await files.get(hash)).toEqual(gif);
		expect(await realFs.readdir(join(root, "assets"))).toEqual([hash]);
	});
	it("snapshots caller bytes before asynchronous filesystem work", async () => {
		const files = emojiFiles(root);
		const bytes = Uint8Array.from(gif);
		const pending = files.put(bytes);
		bytes.fill(0);
		expect(await pending).toBe(hash);
		expect(await files.get(hash)).toEqual(gif);
	});
	it("detects changed assets and never overwrites them during re-import or library recovery", async () => {
		const files = emojiFiles(root);
		await files.put(gif);
		const changed = Buffer.from("changed asset");
		await realFs.writeFile(files.assetPath(hash), changed);
		await expect(files.get(hash)).rejects.toBeInstanceOf(RangeError);
		await expect(files.put(gif)).rejects.toBeInstanceOf(RangeError);
		await realFs.writeFile(primary, "{");
		await realFs.writeFile(backup, JSON.stringify(saved(1)));
		expect(await files.read()).toEqual(saved(1));
		await files.write(saved(2));
		expect(await realFs.readFile(files.assetPath(hash))).toEqual(changed);
		expect(await realFs.readdir(join(root, "assets"))).toEqual([hash]);
	});
	it.each(["write", "link"])(
		"cleans partial staging files when asset %s fails without publishing a hash",
		async (operation) => {
			const cause = Object.assign(new Error("failed publication"), {
				code: "EIO",
			});
			if (operation === "write")
				vi.mocked(fs.writeFile).mockImplementationOnce(
					async (path, _contents, options) => {
						await realFs.writeFile(path, "partial", options);
						throw cause;
					},
				);
			else vi.mocked(fs.link).mockRejectedValueOnce(cause);
			await expect(emojiFiles(root).put(gif)).rejects.toBe(cause);
			expect(await realFs.readdir(join(root, "assets"))).toEqual([]);
		},
	);
	it("rejects malformed asset references before reading outside the managed asset directory", async () => {
		const files = emojiFiles(root);
		for (const reference of [
			"../library.json",
			"f".repeat(63),
			"F".repeat(64),
			"f".repeat(65),
		]) {
			expect(() => files.assetPath(reference)).toThrow(RangeError);
			await expect(files.get(reference)).rejects.toBeInstanceOf(RangeError);
		}
		expect(fs.readFile).not.toHaveBeenCalled();
	});
});
