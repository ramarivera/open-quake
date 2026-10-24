import { basename, posix } from "node:path";
import {
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipReader,
	ZipWriter,
} from "@zip.js/zip.js";
import { Schema } from "effect";
import { BackupInvalid } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";

import { decodeAccountConfig } from "./account-config";

export const backupLimits = {
	archive: 128 * 1024 * 1024,
	total: 256 * 1024 * 1024,
	entry: 32 * 1024 * 1024,
	entries: 8192,
} as const;
/** Public DK-Suite archive compatibility derivation, not a user secret or a security boundary.
 * Account + @ + app name without punctuation in lower case + the format's four-digit year.
 * SETTINGS-014, background.js exportResources/_packFileToZip. Never log the result. */
export function backupPassword(account: string): string {
	return `${account}@${["DK", "Suite"].join("").toLowerCase()}${2026}`;
}
export function backupAccount(fileName: string, current = "default"): string {
	const segments = basename(fileName).split("_");
	const account =
		segments[0] === "DK-Suite" && segments.length > 2
			? (segments[1] ?? current)
			: current;
	if (!/^[a-zA-Z0-9.@-]{1,120}$/.test(account)) throw new BackupInvalid();
	return account;
}
export function safeArchivePath(name: string): string {
	if (
		!name ||
		name.includes("\\") ||
		name.includes(":") ||
		[...name].some((character) => character.charCodeAt(0) < 32) ||
		/^[a-zA-Z]:|^\//.test(name) ||
		name
			.split("/")
			.some(
				(p) =>
					p === ".." ||
					p === "." ||
					!p ||
					/[. ]$/.test(p) ||
					/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
			)
	)
		throw new BackupInvalid();
	if (posix.normalize(name) !== name || name.length > 1024)
		throw new BackupInvalid();
	return name;
}
export const ExportIndex = Schema.Struct({
	originalBasePath: Schema.NonEmptyString,
	originalPlatform: Schema.Literal("darwin", "win32", "linux"),
	originalUserDataPath: Schema.optional(Schema.NonEmptyString),
});
export type ArchiveFiles = ReadonlyMap<string, Uint8Array>;
export async function writeBackup(
	files: ArchiveFiles,
	account = "default",
	signal?: AbortSignal,
): Promise<Uint8Array> {
	const writer = new ZipWriter(new Uint8ArrayWriter(), {
		password: backupPassword(account),
		encryptionStrength: 3,
		level: 9,
		useWebWorkers: false,
	});
	try {
		let total = 0;
		if (files.size > backupLimits.entries) throw new BackupInvalid();
		for (const [path, bytes] of files) {
			safeArchivePath(path);
			total += bytes.length;
			if (bytes.length > backupLimits.entry || total > backupLimits.total)
				throw new BackupInvalid();
			await writer.add(path, new Uint8ArrayReader(bytes), {
				...(signal ? { signal } : {}),
			});
		}
		const bytes = await writer.close();
		if (bytes.length > backupLimits.archive) throw new BackupInvalid();
		return bytes;
	} catch (cause) {
		await writer.close().catch(() => undefined);
		throw new BackupInvalid(cause);
	}
}
export async function readBackup(
	bytes: Uint8Array,
	fileName: string,
	current = "default",
	signal?: AbortSignal,
): Promise<ArchiveFiles> {
	if (bytes.length > backupLimits.archive) throw new BackupInvalid();
	const reader = new ZipReader(new Uint8ArrayReader(bytes), {
		password: backupPassword(backupAccount(fileName, current)),
		useWebWorkers: false,
		checkSignature: true,
		checkOverlappingEntry: true,
	});
	try {
		const entries = await reader.getEntries();
		if (entries.length > backupLimits.entries) throw new BackupInvalid();
		const names = new Set<string>();
		const files = new Map<string, Uint8Array>();
		let total = 0;
		for (const entry of entries) {
			const path = safeArchivePath(
				entry.directory ? entry.filename.replace(/\/$/, "") : entry.filename,
			);
			const normalized = path.toLowerCase();
			if (names.has(normalized)) throw new BackupInvalid();
			names.add(normalized);
			if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
				throw new BackupInvalid();
			if (entry.directory) continue;
			const aes = entry.extraField?.get(0x9901)?.data;
			if (
				!entry.encrypted ||
				entry.zipCrypto ||
				!aes ||
				aes[4] !== 3 ||
				entry.uncompressedSize > backupLimits.entry
			)
				throw new BackupInvalid();
			total += entry.uncompressedSize;
			if (total > backupLimits.total) throw new BackupInvalid();
			const chunks: Uint8Array[] = [];
			let actual = 0;
			await entry.getData(
				new WritableStream<Uint8Array>({
					write(chunk) {
						actual += chunk.length;
						if (actual > backupLimits.entry || actual > entry.uncompressedSize)
							throw new BackupInvalid();
						chunks.push(chunk);
					},
				}),
				{ ...(signal ? { signal } : {}), checkSignature: true },
			);
			if (actual !== entry.uncompressedSize) throw new BackupInvalid();
			files.set(path, Buffer.concat(chunks));
		}
		const index = files.get("export_index.json");
		if (!index) throw new BackupInvalid();
		Schema.decodeUnknownSync(ExportIndex)(
			JSON.parse(Buffer.from(index).toString("utf8")),
		);
		const account = backupAccount(fileName, current);
		const config = files.get(`${account}_config.json`);
		if (!config) throw new BackupInvalid();
		decodeAccountConfig(config, account);
		return files;
	} catch (cause) {
		throw cause instanceof BackupInvalid ? cause : new BackupInvalid(cause);
	} finally {
		await reader.close();
	}
}
