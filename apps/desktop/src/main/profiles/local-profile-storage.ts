import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname } from "node:path";
import {
	createInitialProfileEnvelope,
	type EncodedProfileEnvelope,
	encodeProfileEnvelope,
	isEncodedProfileEnvelope,
	ProfileReadFailed,
	type ProfileStoragePort,
	ProfileWriteFailed,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/index.js";
import type { ProfileCommitGuard } from "../../../../../packages/device/src/profiles/profile-repository.js";

/** Direct domain import until task 2.1 installs/composes the desktop package edge. */
export interface ProfileFileSystem {
	readonly readFile: (path: string) => Promise<string>;
	readonly writeFile: (path: string, contents: string) => Promise<void>;
	readonly rename: (from: string, to: string) => Promise<void>;
	readonly mkdir: (path: string) => Promise<void>;
	readonly remove: (path: string) => Promise<void>;
}
export const profileFileSystem: ProfileFileSystem = {
	readFile: (path) => fs.readFile(path, "utf8"),
	writeFile: (path, contents) =>
		fs.writeFile(path, contents, { encoding: "utf8", mode: 0o600, flag: "wx" }),
	rename: fs.rename,
	mkdir: async (path) => {
		await fs.mkdir(path, { recursive: true });
	},
	remove: (path) => fs.rm(path, { force: true }),
};
const isMissing = (cause: unknown): boolean =>
	cause instanceof Error && "code" in cause && cause.code === "ENOENT";

export interface ProfileRecovery {
	readonly reason:
		| "invalid-primary"
		| "invalid-backup"
		| "restored-backup"
		| "seeded";
}

/** Use only with the app's own userData file, never the proprietary DK-Suite store. */
export function createDesktopProfileStorage(
	path: string,
	io: ProfileFileSystem = profileFileSystem,
): ProfileStoragePort & { readonly recoveries: readonly ProfileRecovery[] } {
	const backupPath = `${path}.bak`;
	const recoveries: ProfileRecovery[] = [];
	const atomicWrite = async (
		target: string,
		contents: string,
		guard?: ProfileCommitGuard,
	): Promise<void> => {
		await io.mkdir(dirname(target));
		const temporary = `${target}.${randomUUID()}.tmp`;
		try {
			await io.writeFile(temporary, contents);
			guard?.();
			await io.rename(temporary, target);
		} finally {
			// A cleanup failure must not turn a completed rename into a reported failed save.
			await io.remove(temporary).catch(() => {});
		}
	};
	const readOptional = async (target: string): Promise<string | undefined> => {
		try {
			return await io.readFile(target);
		} catch (cause) {
			if (isMissing(cause)) return undefined;
			throw cause;
		}
	};
	const parse = (raw: string): unknown => {
		try {
			return JSON.parse(raw);
		} catch {
			return undefined;
		}
	};
	const write = async (
		envelope: EncodedProfileEnvelope,
		guard?: ProfileCommitGuard,
	): Promise<void> => {
		try {
			if (!isEncodedProfileEnvelope(envelope))
				throw new TypeError("Invalid local envelope");
			const previous = await readOptional(path);
			if (previous !== undefined && isEncodedProfileEnvelope(parse(previous)))
				await atomicWrite(backupPath, previous);
			await atomicWrite(path, JSON.stringify(envelope), guard);
		} catch (cause) {
			throw ProfileWriteFailed.fromCause(cause);
		}
	};
	const read = async (): Promise<unknown> => {
		try {
			const primary = await readOptional(path);
			if (primary !== undefined) {
				const value = parse(primary);
				if (isEncodedProfileEnvelope(value)) return value;
				// Keep an untouched copy before recovering or initializing this store.
				await atomicWrite(`${path}.corrupt.${randomUUID()}`, primary);
				recoveries.push({ reason: "invalid-primary" });
			}
			const backup = await readOptional(backupPath);
			if (backup !== undefined) {
				const value = parse(backup);
				if (isEncodedProfileEnvelope(value)) {
					await atomicWrite(path, backup);
					recoveries.push({ reason: "restored-backup" });
					return value;
				}
				recoveries.push({ reason: "invalid-backup" });
			}
			const seed = encodeProfileEnvelope(createInitialProfileEnvelope());
			await atomicWrite(path, JSON.stringify(seed));
			recoveries.push({ reason: "seeded" });
			return seed;
		} catch (cause) {
			throw ProfileReadFailed.fromCause(cause);
		}
	};
	return { read, write, recoveries };
}

export const desktopProfileStorageLayer = (path: string) =>
	profileStorageLayer(createDesktopProfileStorage(path));
