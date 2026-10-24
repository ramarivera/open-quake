import { randomUUID } from "node:crypto";
import {
	cp,
	lstat,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Schema } from "effect";
import { HardwarePreferences } from "../../../../../packages/device/src/hardware/hardware-contracts.js";
import {
	ProfileEnvelope,
	ProfileJson,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { BackupInvalid } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { SavedWallpaper } from "../../shared/display";
import { ClockRecord } from "../clock/clock-store";
import { readBackup, writeBackup } from "./backup-archive";
import {
	backupProjection,
	mergeBackup,
	withoutCredentials,
} from "./backup-merge";
import { backupPaths } from "./backup-paths";

function validateNative(relative: string, data: Uint8Array): void {
	if (!relative.endsWith(".json")) return;
	const value: unknown = JSON.parse(Buffer.from(data).toString("utf8"));
	Schema.decodeUnknownSync(ProfileJson)(value);
	if (relative === "profiles-v1.json")
		Schema.decodeUnknownSync(ProfileEnvelope)(value);
	else if (relative.startsWith("hardware-v1/"))
		Schema.decodeUnknownSync(
			Schema.Struct({
				version: Schema.Literal(1),
				serial: Schema.NonEmptyString,
				preferences: HardwarePreferences,
			}),
		)(value);
	else if (relative.startsWith("wallpaper-v1/settings/"))
		Schema.decodeUnknownSync(SavedWallpaper)(value);
	else if (relative === "clock-v1/clock.json")
		Schema.decodeUnknownSync(ClockRecord)(value);
}
export const managedData = [
	"profiles-v1.json",
	"hardware-v1",
	"wallpaper-v1",
	"clock-v1",
	"appearance.json",
	"backup-resources-v1",
	"backup-legacy",
] as const;
async function assertOwnedDestination(
	root: string,
	destination: string,
): Promise<void> {
	let current = destination;
	while (current !== root) {
		if ((await lstat(current).catch(() => undefined))?.isSymbolicLink())
			throw new BackupInvalid();
		current = dirname(current);
	}
	if ((await lstat(root)).isSymbolicLink()) throw new BackupInvalid();
}
async function readManaged(root: string): Promise<Map<string, Uint8Array>> {
	const files = new Map<string, Uint8Array>();
	async function collect(relative: string): Promise<void> {
		if (/\.(pending|tmp)$/.test(relative)) return;
		const path = join(root, relative);
		const info = await lstat(path).catch(() => undefined);
		if (!info) return;
		if (info.isSymbolicLink()) throw new BackupInvalid();
		if (info.isDirectory()) {
			for (const name of await readdir(path))
				await collect(`${relative}/${name}`);
		} else if (info.isFile()) {
			if (info.size > 32 * 1024 * 1024) throw new BackupInvalid();
			let bytes = await readFile(path);
			validateNative(relative, bytes);
			if (relative.endsWith(".json"))
				bytes = Buffer.from(
					JSON.stringify(
						withoutCredentials(
							Schema.decodeUnknownSync(ProfileJson)(
								JSON.parse(bytes.toString("utf8")),
							),
						),
					),
				);
			files.set(`open-quake/${relative}`, bytes);
		}
	}
	for (const name of managedData) await collect(name);
	return files;
}
export async function exportBackup(
	root: string,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	const files = await readManaged(root);
	const profileBytes = files.get("open-quake/profiles-v1.json");
	if (!profileBytes) throw new BackupInvalid();
	const projection = backupProjection(
		JSON.parse(Buffer.from(profileBytes).toString("utf8")),
		`${root}/resources/default`,
		process.platform,
		[...files]
			.filter(([name]) =>
				/^(open-quake\/(backup-resources-v1|backup-legacy)\/|open-quake\/(wallpaper-v1|clock-v1)\/assets\/)/.test(
					name,
				),
			)
			.map(([name, bytes]) => ({
				source: `${root}/${name.slice("open-quake/".length)}`,
				bytes,
			})),
	);
	for (const [path, bytes] of projection) files.set(path, bytes);
	files.set(
		"export_index.json",
		Buffer.from(
			JSON.stringify({
				originalBasePath: `${root}/resources/default`,
				originalPlatform: process.platform,
				originalUserDataPath: root,
			}),
		),
	);
	return writeBackup(files, "default", signal);
}
/** Validate first. Caller stops every writer before commit; no archive path is extracted into userData. */
export async function prepareRestore(
	bytes: Uint8Array,
	name: string,
	signal?: AbortSignal,
) {
	const files = await readBackup(bytes, name, "default", signal);
	for (const [path, data] of files)
		if (path.startsWith("open-quake/"))
			validateNative(path.slice("open-quake/".length), data);
	return {
		commit: async (
			root: string,
		): Promise<{ imported: number; skipped: number }> => {
			await assertOwnedDestination(root, join(root, "profiles-v1.json"));
			const current: unknown = JSON.parse(
				await readFile(join(root, "profiles-v1.json"), "utf8"),
			);
			const known = new Set(
				await readdir(join(root, "backup-resources-v1")).catch(() => []),
			);
			const result = mergeBackup(files, current, root, known);
			const portable = backupPaths(files, root);
			const stage = join(dirname(root), `.open-quake-restore-${randomUUID()}`);
			const rollback = `${stage}.previous`;
			let switched = false;
			try {
				await cp(root, stage, { recursive: true, dereference: false });
				await assertOwnedDestination(stage, join(stage, "backup-resources-v1"));
				await mkdir(join(stage, "backup-resources-v1"), { recursive: true });
				for (const [id, data] of result.resources)
					await writeFile(join(stage, "backup-resources-v1", id), data, {
						mode: 0o600,
					});
				// Native app settings merge only into owned names. Profiles are always merged and validated above.
				for (const [path, data] of files) {
					if (
						!path.startsWith("open-quake/") ||
						path === "open-quake/profiles-v1.json"
					)
						continue;
					const relative = path.slice("open-quake/".length);
					if (
						!managedData.some(
							(name) => relative === name || relative.startsWith(`${name}/`),
						)
					)
						throw new BackupInvalid();
					const destination = join(stage, relative);
					await assertOwnedDestination(stage, destination);
					await mkdir(dirname(destination), { recursive: true });
					const content = relative.endsWith(".json")
						? Buffer.from(
								JSON.stringify(
									portable.rewrite(
										withoutCredentials(
											Schema.decodeUnknownSync(ProfileJson)(
												JSON.parse(Buffer.from(data).toString("utf8")),
											),
										),
									),
								),
							)
						: data;
					validateNative(relative, content);
					await writeFile(destination, content, { mode: 0o600 });
				}
				for (const [relative, data] of [
					...result.legacyFiles,
					...portable.legacyFiles,
				]) {
					const destination = join(stage, "backup-legacy", relative);
					await assertOwnedDestination(stage, destination);
					await mkdir(dirname(destination), { recursive: true });
					await writeFile(destination, data, { mode: 0o600 });
				}
				Schema.decodeUnknownSync(ProfileEnvelope)(result.envelope);
				await writeFile(
					join(stage, "profiles-v1.json"),
					JSON.stringify(result.envelope),
					{ mode: 0o600 },
				);
				await rename(root, rollback);
				try {
					await rename(stage, root);
					switched = true;
				} catch (cause) {
					await rename(rollback, root);
					throw cause;
				}
				await rm(rollback, { recursive: true, force: true }).catch(
					() => undefined,
				);
				return { imported: result.imported, skipped: result.skipped };
			} finally {
				if (!switched) await rm(stage, { recursive: true, force: true });
			}
		},
	};
}
export async function clearOwnedData(root: string): Promise<void> {
	// root is captured from app.getPath('userData'), never supplied over IPC.
	if (
		!root ||
		root === "/" ||
		basename(root) === "" ||
		(await lstat(root)).isSymbolicLink()
	)
		throw new BackupInvalid();
	const tombstone = join(dirname(root), `.open-quake-cleared-${randomUUID()}`);
	await rename(root, tombstone);
	try {
		await rm(tombstone, { recursive: true, force: true });
	} catch (cause) {
		await rename(tombstone, root);
		throw cause;
	}
}
