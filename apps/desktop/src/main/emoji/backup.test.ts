import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Layer, ManagedRuntime } from "effect";
import { expect, it } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository";
import {
	defaultCaption,
	emptyEmojiStore,
} from "../../../../../packages/edge/src/emoji/emoji-contracts";
import { encodeGif } from "../../shared/gif";
import { readBackup, writeBackup } from "../maintenance/backup-archive";
import { exportBackup, prepareRestore } from "../maintenance/backup-store";
import { proveEmojiMerge } from "./backup-merge-proof";
import { proveEmojiRestore } from "./backup-proof";
import { emojiFiles } from "./files";
import { placeEmojiPackage } from "./profile-placement";

it("restores immutable original/rendered/static assets, library and placed profile into a clean installation and presses the restored item", async () => {
	const scratch = await mkdtemp(join(tmpdir(), "oq-emoji-backup-fixture-"));
	const root = join(scratch, "source");
	await mkdir(root);
	const path = join(root, "profiles-v1.json");
	await writeFile(
		path,
		JSON.stringify(encodeProfileEnvelope(createInitialProfileEnvelope())),
	);
	const profiles = ManagedRuntime.make(
		ProfileRepository.Default.pipe(
			Layer.provide(
				profileStorageLayer({
					read: async () => JSON.parse(await readFile(path, "utf8")),
					write: async (value) => {
						await writeFile(path, JSON.stringify(value));
					},
				}),
			),
		),
	);
	try {
		const files = emojiFiles(join(root, "emoji-v1"));
		const gif = (r: number) =>
			encodeGif({
				width: 1,
				height: 1,
				loopCount: 0,
				frames: [{ rgba: new Uint8ClampedArray([r, 0, 0, 255]), delayMs: 100 }],
			});
		const originalBytes = gif(255),
			renderedBytes = gif(120),
			staticBytes = new Uint8Array([1, 2, 3]);
		const original = await files.put(originalBytes),
			rendered = await files.put(renderedBytes),
			staticHash = await files.put(staticBytes);
		const store = {
			...emptyEmojiStore,
			globalMode: 0 as const,
			items: [
				{
					id: "item",
					name: "Hello",
					original,
					rendered,
					caption: defaultCaption,
				},
			],
			packages: [
				{ id: "daily", name: "Daily", emojiIds: ["item"], profileId: null },
			],
			staticAssets: [
				{ hash: staticHash, name: "source.png", format: "image/png" as const },
			],
		};
		await files.write(store);
		await files.write({ ...store, revision: 1 });
		const placedId = await placeEmojiPackage({
			runtime: profiles,
			select: async () => {},
		})("daily", store);
		await files.write({
			...store,
			packages: store.packages.map((pack) => ({
				...pack,
				profileId: placedId,
			})),
		});
		await mkdir(join(root, "emoji-v1/clipboard"));
		await writeFile(
			join(root, "emoji-v1/clipboard/ignored.gif"),
			"synthetic transient",
		);
		await writeFile(join(root, "emoji-v1/assets/.pending.part"), "incomplete");
		const archive = await exportBackup(root);
		const proof = await proveEmojiRestore(archive, join(scratch, "clean"), {
			itemId: "item",
			original,
			rendered,
			originalBytes,
			renderedBytes,
			staticHash,
			staticBytes,
		});
		expect(proof.syntheticPress).toBe(true);
		expect(
			await proveEmojiMerge(archive, join(scratch, "populated")),
		).toMatchObject({ bothPresses: true, repeatIdempotent: true });
		const archived = new Map(await readBackup(archive, "synthetic.zip"));
		const backupOnly = new Map(archived);
		backupOnly.set(
			"open-quake/emoji-v1/library.backup.json",
			backupOnly.get("open-quake/emoji-v1/library.json") ?? new Uint8Array(),
		);
		backupOnly.delete("open-quake/emoji-v1/library.json");
		expect(
			await proveEmojiMerge(
				await writeBackup(backupOnly),
				join(scratch, "fallback-populated"),
			),
		).toMatchObject({ bothPresses: true, repeatIdempotent: true });
		archived.set(
			`open-quake/emoji-v1/assets/${rendered}`,
			Buffer.from("changed"),
		);
		await expect(
			prepareRestore(await writeBackup(archived), "synthetic.zip"),
		).rejects.toBeDefined();
		const blocked = join(scratch, "blocked");
		await mkdir(blocked);
		await writeFile(
			join(blocked, "profiles-v1.json"),
			JSON.stringify(encodeProfileEnvelope(createInitialProfileEnvelope())),
		);
		await symlink(join(root, "emoji-v1"), join(blocked, "emoji-v1"));
		await expect(
			(await prepareRestore(archive, "synthetic.zip")).validate(blocked),
		).rejects.toBeDefined();
		expect(
			await readFile(
				join(scratch, "clean/emoji-v1/library.backup.json"),
				"utf8",
			),
		).toBeTruthy();
		await expect(
			readFile(join(scratch, "clean/emoji-v1/clipboard/ignored.gif")),
		).rejects.toMatchObject({ code: "ENOENT" });
		await expect(
			readFile(join(scratch, "clean/emoji-v1/assets/.pending.part")),
		).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await profiles.dispose();
		await rm(scratch, { recursive: true, force: true });
	}
});

it.each(["library", "hash", "symlink"])(
	"rejects invalid emoji %s during export",
	async (invalid) => {
		const root = await mkdtemp(
			join(tmpdir(), "oq-emoji-backup-invalid-fixture-"),
		);
		try {
			await writeFile(
				join(root, "profiles-v1.json"),
				JSON.stringify(encodeProfileEnvelope(createInitialProfileEnvelope())),
			);
			const files = emojiFiles(join(root, "emoji-v1"));
			await files.write(emptyEmojiStore);
			const hash = await files.put(new Uint8Array([1]));
			if (invalid === "library")
				await writeFile(
					join(root, "emoji-v1/library.json"),
					JSON.stringify({ version: 99 }),
				);
			if (invalid === "hash") await writeFile(files.assetPath(hash), "changed");
			if (invalid === "symlink") {
				await rm(files.assetPath(hash));
				await symlink(join(root, "profiles-v1.json"), files.assetPath(hash));
			}
			await expect(exportBackup(root)).rejects.toBeDefined();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
