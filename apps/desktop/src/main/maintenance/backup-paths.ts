import { createHash } from "node:crypto";
import { Schema } from "effect";
import type { ProfileJson } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { BackupInvalid } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import {
	type ArchiveFiles,
	ExportIndex,
	safeArchivePath,
} from "./backup-archive";

/** Rewrite only archived paths. An absent file must not become a plausible but broken destination. */
export function backupPaths(files: ArchiveFiles, destination: string) {
	const index = Schema.decodeUnknownSync(ExportIndex)(
		JSON.parse(
			Buffer.from(files.get("export_index.json") ?? []).toString("utf8"),
		),
	);
	const legacyFiles = new Map<string, Uint8Array>();
	const path = (value: string): string => {
		const normalized = value.replaceAll("\\", "/");
		const base = index.originalBasePath
			.replaceAll("\\", "/")
			.replace(/\/$/, "");
		if (normalized.startsWith(`${base}/`)) {
			const relative = safeArchivePath(normalized.slice(base.length + 1));
			const selected = [...files]
				.filter(
					([name]) => name === relative || name.startsWith(`${relative}/`),
				)
				.sort(([a], [b]) => a.localeCompare(b));
			if (!selected.length) throw new BackupInvalid();
			const hash = createHash("sha256");
			for (const [name, bytes] of selected) {
				hash.update(
					JSON.stringify([
						name,
						createHash("sha256").update(bytes).digest("hex"),
					]),
				);
			}
			const namespace = hash.digest("hex");
			for (const [name, bytes] of selected)
				legacyFiles.set(`${namespace}/${name}`, bytes);
			return `${destination}/backup-legacy/${namespace}/${relative}`;
		}
		const native = index.originalUserDataPath
			?.replaceAll("\\", "/")
			.replace(/\/$/, "");
		if (native && normalized.startsWith(`${native}/`)) {
			const relative = safeArchivePath(normalized.slice(native.length + 1));
			if (
				![...files.keys()].some(
					(name) =>
						name === `open-quake/${relative}` ||
						name.startsWith(`open-quake/${relative}/`),
				)
			)
				throw new BackupInvalid();
			return `${destination}/${relative}`;
		}
		return value;
	};
	const rewrite = (value: typeof ProfileJson.Type): typeof ProfileJson.Type => {
		if (typeof value === "string") return path(value);
		if (Array.isArray(value)) return value.map(rewrite);
		if (value && typeof value === "object")
			return Object.fromEntries(
				Object.entries(value).map(([key, item]) => [key, rewrite(item)]),
			);
		return value;
	};
	return { path, rewrite, legacyFiles };
}
