import { createHash } from "node:crypto";
import { join } from "node:path";
import { Option, Schema } from "effect";
import { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	EmojiKeyReference,
	EmojiStore,
	emptyEmojiStore,
} from "../../../../../packages/edge/src/emoji/emoji-contracts";
import { BackupInvalid } from "../../../../../packages/edge/src/maintenance/maintenance-errors";
import { emojiFiles } from "../emoji/files";

const library = "open-quake/emoji-v1/library.json";
const backupLibrary = "open-quake/emoji-v1/library.backup.json";
const stable = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
};
function mergeRecords<T extends { readonly id: string }>(
	current: readonly T[],
	incoming: readonly T[],
	identity: (value: T) => unknown = ({ id: _id, ...value }) => value,
) {
	if (
		new Set(current.map((v) => v.id)).size !== current.length ||
		new Set(incoming.map((v) => v.id)).size !== incoming.length
	)
		throw new BackupInvalid();
	const records = [...current];
	const ids = new Map<string, string>();
	const added = new Set<string>();
	for (const value of incoming) {
		const content = stable(identity(value));
		let id = value.id;
		const collision = records.find((record) => record.id === id);
		if (collision && stable(identity(collision)) !== content) {
			const base = `import-${createHash("sha256").update(content).digest("hex")}`;
			id = base;
			let suffix = 1;
			while (
				records.some(
					(record) => record.id === id && stable(identity(record)) !== content,
				)
			)
				id = `${base}-${suffix++}`;
		}
		if (!records.some((record) => record.id === id)) {
			records.push({ ...value, id });
			added.add(id);
		}
		ids.set(value.id, id);
	}
	return { records, ids, added };
}
/** Destination authority survives restore; imported collisions receive deterministic identities. */
export async function prepareEmojiBackupMerge(
	files: ReadonlyMap<string, Uint8Array>,
	root: string,
) {
	const bytes = files.get(library) ?? files.get(backupLibrary);
	if (!bytes) return { files: new Map(files), finish: () => undefined };
	const incoming = Schema.decodeUnknownSync(EmojiStore)(
		JSON.parse(Buffer.from(bytes).toString("utf8")),
	);
	const stored = await emojiFiles(join(root, "emoji-v1")).read();
	const current = stored ?? emptyEmojiStore;
	const items = mergeRecords(current.items, incoming.items);
	const packages = mergeRecords(
		current.packages,
		incoming.packages.map((pack) => ({
			...pack,
			emojiIds: pack.emojiIds.map((id) => items.ids.get(id) ?? id),
		})),
		({ id: _id, profileId: _profileId, ...value }) => value,
	);
	const rewritten = new Map(files);
	const profiles = files.get("open-quake/profiles-v1.json");
	if (profiles) {
		const envelope = Schema.encodeSync(ProfileEnvelope)(
			Schema.decodeUnknownSync(ProfileEnvelope)(
				JSON.parse(Buffer.from(profiles).toString("utf8")),
			),
		);
		rewritten.set(
			"open-quake/profiles-v1.json",
			Buffer.from(
				JSON.stringify({
					...envelope,
					profiles: envelope.profiles.map((profile) => ({
						...profile,
						pages: profile.pages.map((page) => ({
							...page,
							keys: page.keys.map((key) => ({
								...key,
								config: {
									...key.config,
									actions: key.config.actions?.map((action) => {
										if (
											key.config.type !== "emoji" ||
											action.type !== "emojiConfig"
										)
											return action;
										const ref = Schema.decodeUnknownOption(EmojiKeyReference)(
											action.value,
										);
										return Option.isNone(ref)
											? action
											: {
													...action,
													value: {
														...ref.value,
														packageId:
															packages.ids.get(ref.value.packageId) ??
															ref.value.packageId,
														emojiId:
															items.ids.get(ref.value.emojiId) ??
															ref.value.emojiId,
													},
												};
									}),
								},
							})),
						})),
					})),
				}),
			),
		);
	}
	return {
		files: rewritten,
		finish: (profileIds: ReadonlyMap<string, string> = new Map()): EmojiStore =>
			Schema.decodeUnknownSync(EmojiStore)({
				...(stored ?? incoming),
				revision: Math.max(current.revision, incoming.revision) + 1,
				items: items.records,
				packages: packages.records.map((pack) =>
					packages.added.has(pack.id)
						? {
								...pack,
								profileId:
									pack.profileId === null
										? null
										: (profileIds.get(pack.profileId) ?? null),
							}
						: pack,
				),
				staticAssets: [
					...current.staticAssets,
					...incoming.staticAssets.filter(
						(asset) =>
							!current.staticAssets.some(
								(existing) => existing.hash === asset.hash,
							),
					),
				],
				drafts: [
					...new Set([
						...current.drafts,
						...incoming.drafts.map((id) => items.ids.get(id) ?? id),
					]),
				],
			}),
	};
}
