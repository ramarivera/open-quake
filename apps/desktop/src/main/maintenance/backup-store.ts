import { createHash, randomUUID } from "node:crypto";
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
import { EmojiStore } from "../../../../../packages/edge/src/emoji/emoji-contracts.js";
import { BackupInvalid } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { SettingsDocument } from "../../../../../packages/edge/src/settings/settings-contracts.js";
import { SavedWallpaper } from "../../shared/display";
import { MonitorRecord } from "../../shared/monitor-contracts";
import { ClockRecord } from "../clock/clock-store";
import {
	decodeAppLibrary,
	prepareAppLibraryBackupMerge,
} from "./app-library-backup";
import { appearanceRecord } from "./appearance-backup";
import { readBackup, writeBackup } from "./backup-archive";
import { BackupFiles, BackupReadBudget } from "./backup-budget";
import {
	backupProjection,
	mergeBackup,
	withoutCredentials,
} from "./backup-merge";
import { backupPaths } from "./backup-paths";
import { readBackupFile } from "./backup-read";
import { archiveClockMedia } from "./clock-backup";
import { prepareEmojiBackupMerge } from "./emoji-backup-merge";
import { decodeIconLibrary, prepareIconBackupMerge } from "./icon-backup";

function validateNative(relative: string, data: Uint8Array): void {
	if (relative.startsWith("emoji-v1/assets/")) {
		const hash = relative.slice("emoji-v1/assets/".length);
		if (
			!/^[a-f0-9]{64}$/.test(hash) ||
			createHash("sha256").update(data).digest("hex") !== hash
		)
			throw new BackupInvalid();
		return;
	}
	if (
		relative.startsWith("emoji-v1/") &&
		relative !== "emoji-v1/library.json" &&
		relative !== "emoji-v1/library.backup.json"
	)
		throw new BackupInvalid();
	if (
		relative.startsWith("key-library-v1.json/") ||
		relative.startsWith("app-library-v1.json/") ||
		relative.startsWith("settings-v1.json/")
	)
		throw new BackupInvalid();
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
	else if (relative === "settings-v1.json")
		Schema.decodeUnknownSync(SettingsDocument)(value);
	else if (relative === "monitor-v1/settings.json")
		Schema.decodeUnknownSync(MonitorRecord)(value);
	else if (relative === "key-library-v1.json") decodeIconLibrary(data);
	else if (relative === "app-library-v1.json") decodeAppLibrary(data);
	else if (relative === "appearance.json")
		appearanceRecord(Buffer.from(data).toString("utf8"));
	else if (
		relative === "emoji-v1/library.json" ||
		relative === "emoji-v1/library.backup.json"
	)
		Schema.decodeUnknownSync(EmojiStore, { onExcessProperty: "error" })(value);
}
export const managedData = [
	"profiles-v1.json",
	"hardware-v1",
	"wallpaper-v1",
	"clock-v1",
	"monitor-v1",
	"appearance.json",
	"settings-v1.json",
	"key-library-v1.json",
	"app-library-v1.json",
	"emoji-v1/library.json",
	"emoji-v1/library.backup.json",
	"emoji-v1/assets",
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
async function readManaged(
	root: string,
	budget: BackupReadBudget,
	signal?: AbortSignal,
): Promise<BackupFiles> {
	const files = new BackupFiles();
	async function collect(relative: string): Promise<void> {
		if (/\.(pending|tmp)$/.test(relative)) return;
		if (relative === "monitor-v1/settings.json.new") return;
		if (relative.startsWith("emoji-v1/assets/") && relative.endsWith(".part"))
			return;
		const path = join(root, relative);
		const info = await lstat(path).catch(() => undefined);
		if (!info) return;
		if (info.isSymbolicLink()) throw new BackupInvalid();
		if (
			(relative === "key-library-v1.json" ||
				relative === "app-library-v1.json" ||
				relative === "settings-v1.json") &&
			!info.isFile()
		)
			throw new BackupInvalid();
		if (info.isDirectory()) {
			for (const name of (await readdir(path)).sort())
				await collect(`${relative}/${name}`);
		} else if (info.isFile()) {
			const entry = `open-quake/${relative}`;
			let bytes = await readBackupFile(path, budget, signal, (size) =>
				files.check(entry, size),
			);
			validateNative(relative, bytes);
			if (relative.endsWith(".json"))
				bytes = Buffer.from(
					JSON.stringify(
						withoutCredentials(
							Schema.decodeUnknownSync(ProfileJson)(
								JSON.parse(Buffer.from(bytes).toString("utf8")),
							),
						),
					),
				);
			files.set(`open-quake/${relative}`, bytes);
		}
	}
	for (const name of managedData) {
		if (name === "clock-v1") {
			const profiles = files.get("open-quake/profiles-v1.json");
			if (
				profiles &&
				Schema.decodeUnknownSync(ProfileEnvelope)(
					JSON.parse(Buffer.from(profiles).toString("utf8")),
				).clockConfigVersion === 1
			)
				continue;
		}
		await collect(name);
	}
	return files;
}
export async function exportBackup(
	root: string,
	signal?: AbortSignal,
	appearance?: string,
): Promise<Uint8Array> {
	const budget = new BackupReadBudget();
	const files = await readManaged(root, budget, signal);
	await archiveClockMedia(files, root, budget, signal);
	if (appearance !== undefined)
		files.set(
			"open-quake/appearance.json",
			Buffer.from(appearanceRecord(appearance)),
		);
	const profileBytes = files.get("open-quake/profiles-v1.json");
	if (!profileBytes) throw new BackupInvalid();
	backupProjection(
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
		files,
	);
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
		if (path.startsWith("open-quake/")) {
			const relative = path.slice("open-quake/".length);
			if (
				!managedData.some(
					(name) => relative === name || relative.startsWith(`${name}/`),
				)
			)
				throw new BackupInvalid();
			validateNative(relative, data);
		}
	const validate = async (root: string): Promise<void> => {
		await assertOwnedDestination(root, join(root, "profiles-v1.json"));
		for (const path of files.keys())
			if (path.startsWith("open-quake/"))
				await assertOwnedDestination(
					root,
					join(root, path.slice("open-quake/".length)),
				);
		const current: unknown = JSON.parse(
			await readFile(join(root, "profiles-v1.json"), "utf8"),
		);
		const known = new Set(
			await readdir(join(root, "backup-resources-v1")).catch(() => []),
		);
		await assertOwnedDestination(root, join(root, "emoji-v1/library.json"));
		await assertOwnedDestination(
			root,
			join(root, "emoji-v1/library.backup.json"),
		);
		await assertOwnedDestination(root, join(root, "key-library-v1.json"));
		await prepareIconBackupMerge(files, root);
		const emoji = await prepareEmojiBackupMerge(files, root);
		const result = mergeBackup(emoji.files, current, root, known);
		await assertOwnedDestination(root, join(root, "app-library-v1.json"));
		await prepareAppLibraryBackupMerge(files, root, result.envelope);
	};
	return {
		validate,
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
			await assertOwnedDestination(root, join(root, "emoji-v1/library.json"));
			await assertOwnedDestination(
				root,
				join(root, "emoji-v1/library.backup.json"),
			);
			await assertOwnedDestination(root, join(root, "key-library-v1.json"));
			const icons = await prepareIconBackupMerge(files, root);
			const emoji = await prepareEmojiBackupMerge(files, root);
			const result = mergeBackup(emoji.files, current, root, known);
			await assertOwnedDestination(root, join(root, "app-library-v1.json"));
			const apps = await prepareAppLibraryBackupMerge(
				files,
				root,
				result.envelope,
			);
			const mergedEmoji = emoji.finish(result.profileIds);
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
						path === "open-quake/profiles-v1.json" ||
						path === "open-quake/key-library-v1.json" ||
						path === "open-quake/app-library-v1.json" ||
						path === "open-quake/emoji-v1/library.json" ||
						path === "open-quake/emoji-v1/library.backup.json"
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
				const libraryDestination = join(stage, "app-library-v1.json");
				await assertOwnedDestination(stage, libraryDestination);
				await writeFile(libraryDestination, JSON.stringify(apps), {
					mode: 0o600,
				});
				if (icons) {
					const destination = join(stage, "key-library-v1.json");
					await assertOwnedDestination(stage, destination);
					await writeFile(destination, JSON.stringify(icons), { mode: 0o600 });
				}
				if (mergedEmoji) {
					for (const name of ["library.json", "library.backup.json"]) {
						const destination = join(stage, "emoji-v1", name);
						await assertOwnedDestination(stage, destination);
						await mkdir(dirname(destination), { recursive: true });
						await writeFile(destination, JSON.stringify(mergedEmoji), {
							mode: 0o600,
						});
					}
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
