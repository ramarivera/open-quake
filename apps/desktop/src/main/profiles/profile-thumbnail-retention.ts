import { lstat, opendir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { translateProfile } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import type { Profile } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileThumbnailFailed } from "../../../../../packages/device/src/profiles/profile-errors.js";
import { ProfileLocale } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { profileThumbnailKey } from "./profile-thumbnail-key";

const pngName = /^[a-f0-9]{64}\.png$/;
const pendingName =
	/^[a-f0-9]{64}\.png\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.pending$/;
const pendingGraceMs = 24 * 60 * 60 * 1000;
const missing = (cause: unknown): boolean =>
	cause instanceof Error && "code" in cause && cause.code === "ENOENT";

/** Caller serializes this sweep with publication. Never follow links or remove unknown entries. */
export async function pruneProfileThumbnails(
	directory: string,
	profiles: readonly Profile[],
): Promise<void> {
	const keep = new Set(
		profiles.flatMap((profile) =>
			ProfileLocale.literals.map(
				(locale) =>
					`${profileThumbnailKey(translateProfile(profile, locale), locale)}.png`,
			),
		),
	);
	try {
		const directoryInfo = await lstat(directory);
		if (directoryInfo.isSymbolicLink()) return;
		const entries = await opendir(directory);
		// Iterate instead of loading an arbitrarily large orphan directory into memory.
		for await (const entry of entries) {
			if (!entry.isFile() || keep.has(entry.name)) continue;
			const pending = pendingName.test(entry.name);
			if (!pending && !pngName.test(entry.name)) continue;
			const path = join(directory, entry.name);
			try {
				const info = await lstat(path);
				if (
					!info.isFile() ||
					(pending && Date.now() - info.mtimeMs < pendingGraceMs)
				)
					continue;
				await unlink(path);
			} catch (cause) {
				if (!missing(cause)) throw cause;
			}
		}
	} catch (cause) {
		if (!missing(cause)) throw ProfileThumbnailFailed.fromCause(cause);
	}
}
