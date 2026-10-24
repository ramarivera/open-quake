/** Synthetic backup consumer proof shared by the regression and native fixture. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { EmojiKeyReference } from "../../../../../packages/edge/src/emoji/emoji-contracts";
import {
	EmojiRepository,
	emojiStorageLayer,
} from "../../../../../packages/edge/src/emoji/emoji-repository";
import {
	EmojiPress,
	EmojiPressAdapters,
} from "../../../../../packages/edge/src/emoji/emoji-service";
import { prepareRestore } from "../maintenance/backup-store";
import { emojiFiles } from "./files";

export async function proveEmojiRestore(
	backup: Uint8Array,
	root: string,
	expected: {
		readonly original: string;
		readonly rendered: string;
		readonly originalBytes: Uint8Array;
		readonly renderedBytes: Uint8Array;
		readonly itemId: string;
		readonly staticHash: string;
		readonly staticBytes: Uint8Array;
	},
) {
	await mkdir(root);
	await writeFile(
		join(root, "profiles-v1.json"),
		JSON.stringify(encodeProfileEnvelope(createInitialProfileEnvelope())),
	);
	const restore = await prepareRestore(backup, "synthetic.zip");
	await restore.validate(root);
	await restore.commit(root);
	const files = emojiFiles(join(root, "emoji-v1"));
	const store = await files.read();
	assert(store, "Restored library must exist on a clean root");
	assert(store.items.some((item) => item.id === expected.itemId));
	assert.deepEqual(
		await files.get(expected.original),
		Buffer.from(expected.originalBytes),
	);
	assert.deepEqual(
		await files.get(expected.rendered),
		Buffer.from(expected.renderedBytes),
	);
	assert.deepEqual(
		await files.get(expected.staticHash),
		Buffer.from(expected.staticBytes),
	);
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)(
		JSON.parse(await readFile(join(root, "profiles-v1.json"), "utf8")),
	);
	const key = envelope.profiles
		.flatMap((p) => p.pages.flatMap((p) => p.keys))
		.find((key) => key.config.icon === `emoji:${expected.rendered}`);
	assert(key, "Restored profile must retain its immutable emoji reference");
	const ref = Schema.decodeUnknownSync(EmojiKeyReference)(
		key.config.actions.find((action) => action.type === "emojiConfig")?.value,
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
							const path = await files.clipboardPath(hash);
							assert.deepEqual(
								await readFile(path),
								Buffer.from(expected.renderedBytes),
							);
							copied.push(hash);
						}),
					keyboard: () =>
						Effect.die("Copy-only synthetic proof must never type"),
				}),
			),
		),
	);
	try {
		assert.equal(
			await runtime.runPromise(EmojiPress.press(ref, 0, 1)),
			"copied",
		);
		assert.deepEqual(copied, [expected.rendered]);
	} finally {
		await runtime.dispose();
	}
	return {
		library: true,
		original: true,
		rendered: true,
		staticAsset: true,
		profileReference: true,
		syntheticPress: true,
	};
}
