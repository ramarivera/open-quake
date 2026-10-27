import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { OBS_IDS } from "../../../../../packages/device/src/actions/obs-contracts.js";
import {
	APP_LIBRARY_MAX_BYTES,
	AppLibrarySnapshot,
	mergeMissingDefaultAppMenu,
} from "../../../../../packages/device/src/profiles/app-library.js";
import {
	ProfileEnvelope,
	ProfileJson,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { BackupInvalid } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { backupPaths } from "./backup-paths";

export function decodeAppLibrary(bytes: Uint8Array): AppLibrarySnapshot {
	if (bytes.byteLength > APP_LIBRARY_MAX_BYTES) throw new BackupInvalid();
	return Schema.decodeUnknownSync(AppLibrarySnapshot)(
		JSON.parse(Buffer.from(bytes).toString("utf8")),
	);
}

/** Reuse the library's version-one contract; merge before staging any restore writes. */
export async function prepareAppLibraryBackupMerge(
	files: ReadonlyMap<string, Uint8Array>,
	root: string,
	envelope: typeof ProfileEnvelope.Encoded,
): Promise<typeof AppLibrarySnapshot.Encoded> {
	const saved = await readFile(join(root, "app-library-v1.json")).catch(
		(cause: unknown) => {
			if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
				return undefined;
			throw cause;
		},
	);
	const current = saved
		? decodeAppLibrary(saved)
		: { version: 1 as const, revision: 0, groups: [] };
	const incoming = files.get("open-quake/app-library-v1.json");
	const groups = current.groups.map((group) => ({
		...group,
		children: [...group.children],
	}));
	const add = (subMenu: string, children: readonly ProfileKey[]) => {
		let group = groups.find((value) => value.subMenu === subMenu);
		if (!group) {
			group = { subMenu, children: [] };
			groups.push(group);
		}
		const seen = new Set(
			group.children.map((key) =>
				JSON.stringify(Schema.encodeSync(ProfileKey)(key)),
			),
		);
		for (const key of children) {
			const encoded = JSON.stringify(Schema.encodeSync(ProfileKey)(key));
			if (seen.has(encoded)) continue;
			group.children.push(key);
			seen.add(encoded);
		}
	};
	if (incoming) {
		const portable = backupPaths(files, root);
		decodeAppLibrary(incoming);
		const decoded = decodeAppLibrary(
			Buffer.from(
				JSON.stringify(
					portable.rewrite(
						Schema.decodeUnknownSync(ProfileJson)(
							JSON.parse(Buffer.from(incoming).toString("utf8")),
						),
					),
				),
			),
		);
		for (const group of decoded.groups) add(group.subMenu, group.children);
	}
	const profiles = Schema.decodeUnknownSync(ProfileEnvelope)(envelope);
	const obs = profiles.profiles
		.flatMap((profile) => profile.pages.flatMap((page) => page.keys))
		.filter((key) => OBS_IDS.some((id) => id === key.config.type));
	if (obs.length) add("obsStudio", obs);
	const result = Schema.encodeSync(AppLibrarySnapshot)({
		...current,
		revision: current.revision + 1,
		groups: mergeMissingDefaultAppMenu(groups),
	});
	if (Buffer.byteLength(JSON.stringify(result), "utf8") > APP_LIBRARY_MAX_BYTES)
		throw new BackupInvalid();
	return result;
}
