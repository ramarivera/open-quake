import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { BackupInvalid } from "../../../../../packages/edge/src/maintenance/maintenance-errors";
import { type IconAsset, IconPack } from "../key-library/icon-packs";

export function decodeIconLibrary(bytes: Uint8Array): readonly IconPack[] {
	const packs = Schema.decodeUnknownSync(Schema.Array(IconPack), {
		onExcessProperty: "error",
	})(JSON.parse(Buffer.from(bytes).toString("utf8")));
	if (new Set(packs.map((pack) => pack.id)).size !== packs.length)
		throw new BackupInvalid();
	// Import IDs are artwork hashes. Distinct named aliases can share one ID.
	return packs.map((pack) => ({ ...pack, icons: mergeIcons([], pack.icons) }));
}

/** Icon references embed artwork, so collision IDs can change without rewriting profiles. */
function mergeIcons(
	current: readonly IconAsset[],
	incoming: readonly IconAsset[],
) {
	const icons = [...current];
	const fingerprint = (icon: IconAsset) =>
		createHash("sha256")
			.update(JSON.stringify([icon.name, icon.tags, icon.data]))
			.digest("hex");
	const ids = new Set(current.map((icon) => icon.id));
	const contents = new Set(current.map(fingerprint));
	for (const icon of incoming) {
		const content = fingerprint(icon);
		if (contents.has(content)) continue;
		let id = icon.id;
		if (ids.has(id)) {
			const base = `import-${content}`;
			id = base;
			let suffix = 1;
			while (ids.has(id)) id = `${base}-${suffix++}`;
		}
		icons.push({ ...icon, id });
		ids.add(id);
		contents.add(content);
	}
	return icons;
}

export async function prepareIconBackupMerge(
	files: ReadonlyMap<string, Uint8Array>,
	root: string,
): Promise<readonly IconPack[] | undefined> {
	const bytes = files.get("open-quake/key-library-v1.json");
	if (!bytes) return undefined;
	const incoming = decodeIconLibrary(bytes);
	const stored = await readFile(join(root, "key-library-v1.json")).catch(
		(cause: unknown) => {
			if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
				return undefined;
			throw cause;
		},
	);
	const packs = [...(stored ? decodeIconLibrary(stored) : [])];
	for (const pack of incoming) {
		const index = packs.findIndex((value) => value.id === pack.id);
		const current = packs[index];
		if (current)
			packs[index] = {
				...current,
				icons: mergeIcons(current.icons, pack.icons),
			};
		else packs.push(pack);
	}
	return packs;
}
