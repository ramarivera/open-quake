/** Synthetic populated-destination restore proof, also exercised inside Electron. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository";
import {
	EmojiKeyReference,
	EmojiStore,
} from "../../../../../packages/edge/src/emoji/emoji-contracts";
import {
	EmojiRepository,
	emojiStorageLayer,
} from "../../../../../packages/edge/src/emoji/emoji-repository";
import {
	EmojiPress,
	EmojiPressAdapters,
} from "../../../../../packages/edge/src/emoji/emoji-service";
import { encodeGif } from "../../shared/gif";
import { readBackup } from "../maintenance/backup-archive";
import { prepareRestore } from "../maintenance/backup-store";
import { emojiFiles } from "./files";
import { placeEmojiPackage } from "./profile-placement";

export async function proveEmojiMerge(backup: Uint8Array, root: string) {
	const archive = await readBackup(backup, "synthetic.zip");
	const incoming = Schema.decodeUnknownSync(EmojiStore)(
		JSON.parse(
			Buffer.from(
				archive.get("open-quake/emoji-v1/library.json") ??
					archive.get("open-quake/emoji-v1/library.backup.json") ??
					[],
			).toString(),
		),
	);
	const importedItem = incoming.items[0],
		importedPackage = incoming.packages[0];
	assert(importedItem && importedPackage);
	await mkdir(root);
	const path = join(root, "profiles-v1.json");
	await writeFile(
		path,
		JSON.stringify(encodeProfileEnvelope(createInitialProfileEnvelope())),
	);
	const files = emojiFiles(join(root, "emoji-v1"));
	const ownHash = await files.put(
		encodeGif({
			width: 1,
			height: 1,
			loopCount: 0,
			frames: [
				{ rgba: new Uint8ClampedArray([0, 17, 255, 255]), delayMs: 100 },
			],
		}),
	);
	const staticHash = await files.put(new Uint8Array([9, 8, 7]));
	const ownItem = {
		...importedItem,
		name: "Retained",
		original: ownHash,
		rendered: ownHash,
	};
	const ownPackage = {
		...importedPackage,
		name: "Retained",
		emojiIds: [ownItem.id],
		profileId: null,
	};
	let current: EmojiStore = {
		...incoming,
		items: [ownItem],
		packages: [ownPackage],
		drafts: [ownItem.id],
		staticAssets: [
			{ hash: staticHash, name: "Retained.png", format: "image/png" },
		],
		appMatch: false,
		apps: [
			{
				name: "Retained",
				path: "/synthetic/Retained.app",
				identifier: "synthetic.retained",
			},
		],
		globalMode: 0,
	};
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
		const profileId = await placeEmojiPackage({
			runtime: profiles,
			select: async () => {},
		})(ownPackage.id, current);
		current = { ...current, packages: [{ ...ownPackage, profileId }] };
		await files.write(current);
	} finally {
		await profiles.dispose();
	}
	const restore = await prepareRestore(backup, "synthetic.zip");
	await restore.validate(root);
	await restore.commit(root);
	const first = await files.read();
	assert(first);
	assert.equal(first.items.length, incoming.items.length + 1);
	assert.equal(first.packages.length, incoming.packages.length + 1);
	assert.deepEqual(
		first.items.find((i) => i.id === ownItem.id),
		ownItem,
	);
	assert.deepEqual(
		first.packages.find((p) => p.id === ownPackage.id),
		current.packages[0],
	);
	assert.equal(first.appMatch, current.appMatch);
	assert.equal(first.globalMode, current.globalMode);
	assert.deepEqual(first.apps, current.apps);
	assert(first.staticAssets.some((a) => a.hash === staticHash));
	assert(first.drafts.includes(ownItem.id));
	const imported = first.items.find(
		(i) => i.rendered === importedItem.rendered,
	);
	assert(imported && imported.id !== ownItem.id);
	const pack = first.packages.find(
		(p) => p.id !== ownPackage.id && p.emojiIds.includes(imported.id),
	);
	assert(pack?.profileId);
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)(
		JSON.parse(await readFile(path, "utf8")),
	);
	const copied: string[] = [];
	const runtime = ManagedRuntime.make(
		EmojiPress.DefaultWithoutDependencies.pipe(
			Layer.provide(
				EmojiRepository.Default.pipe(Layer.provide(emojiStorageLayer(files))),
			),
			Layer.provide(
				Layer.succeed(EmojiPressAdapters, {
					platform: "darwin",
					foreground: () => Effect.succeed(Option.none()),
					copyGif: (hash) =>
						Effect.promise(async () => {
							await files.clipboardPath(hash);
							copied.push(hash);
						}),
					keyboard: () => Effect.die("Synthetic copy-only proof must not type"),
				}),
			),
		),
	);
	try {
		for (const profileId of [current.packages[0]?.profileId, pack.profileId]) {
			const key = envelope.profiles.find((p) => p.id === profileId)?.pages[0]
				.keys[0];
			assert(key);
			const ref = Schema.decodeUnknownSync(EmojiKeyReference)(
				key.config.actions.find((a) => a.type === "emojiConfig")?.value,
			);
			assert.equal(
				await runtime.runPromise(EmojiPress.press(ref, 0, 1)),
				"copied",
			);
		}
	} finally {
		await runtime.dispose();
	}
	assert.deepEqual(copied, [ownHash, importedItem.rendered]);
	await restore.commit(root);
	const repeated = await files.read();
	assert(repeated);
	assert.deepEqual({ ...repeated, revision: 0 }, { ...first, revision: 0 });
	assert.deepEqual(
		Schema.decodeUnknownSync(ProfileEnvelope)(
			JSON.parse(await readFile(path, "utf8")),
		).profiles,
		envelope.profiles,
	);
	return {
		destinationPreserved: true,
		collisionRemapped: true,
		profileLinks: true,
		bothPresses: true,
		repeatIdempotent: true,
	};
}
