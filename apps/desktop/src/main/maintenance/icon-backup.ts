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
	if (
		new Set(packs.map((pack) => pack.id)).size !== packs.length ||
		packs.some(
			(pack) =>
				new Set(pack.icons.map((icon) => icon.id)).size !== pack.icons.length,
		)
	)
		throw new BackupInvalid();
	return packs;
}

/** Icon references embed artwork, so collision IDs can change without rewriting profiles. */
function mergeIcons(
	current: readonly IconAsset[],
	incoming: readonly IconAsset[],
) {
	const icons = [...current];
	for (const icon of incoming) {
		const content = JSON.stringify([icon.name, icon.tags, icon.data]);
		const same = (value: IconAsset) =>
			JSON.stringify([value.name, value.tags, value.data]) === content;
		let id = icon.id;
		if (icons.some((value) => value.id === id && !same(value))) {
			const base = `import-${createHash("sha256").update(content).digest("hex")}`;
			id = base;
			let suffix = 1;
			while (icons.some((value) => value.id === id && !same(value)))
				id = `${base}-${suffix++}`;
		}
		if (!icons.some((value) => value.id === id)) icons.push({ ...icon, id });
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
