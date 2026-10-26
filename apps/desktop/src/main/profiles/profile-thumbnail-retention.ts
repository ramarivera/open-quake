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
export function createProfileThumbnailPruner(directory: string) {
	let cache = new Map<
		string,
		{ readonly content: string; readonly names: readonly string[] }
	>();
	const keepNames = (profiles: readonly Profile[]): Set<string> => {
		const next = new Map<
			string,
			{ readonly content: string; readonly names: readonly string[] }
		>();
		const keep = new Set<string>();
		for (const profile of profiles) {
			const content = JSON.stringify(profile);
			const previous = cache.get(profile.id);
			const entry =
				previous?.content === content
					? previous
					: {
							content,
							names: ProfileLocale.literals.flatMap((locale) =>
								[true, false].map(
									(show) =>
										`${profileThumbnailKey(translateProfile(profile, locale), locale, show)}.png`,
								),
							),
						};
			next.set(profile.id, entry);
			for (const name of entry.names) keep.add(name);
		}
		// Retain only the current catalog, not every revision seen during this session.
		cache = next;
		return keep;
	};
	return async (profiles: readonly Profile[]): Promise<void> => {
		try {
			const directoryInfo = await lstat(directory);
			if (directoryInfo.isSymbolicLink()) return;
			const entries = await opendir(directory);
			let keep: Set<string> | undefined;
			// Iterate instead of loading an arbitrarily large orphan directory into memory.
			for await (const entry of entries) {
				if (!entry.isFile()) continue;
				const pending = pendingName.test(entry.name);
				if (!pending) {
					if (!pngName.test(entry.name)) continue;
					keep ??= keepNames(profiles);
					if (keep.has(entry.name)) continue;
				}
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
	};
}
