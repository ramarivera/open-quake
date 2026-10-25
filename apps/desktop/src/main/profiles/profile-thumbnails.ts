import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Option } from "effect";
import { nativeImage } from "electron";
import type { Profile } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileThumbnailFailed } from "../../../../../packages/device/src/profiles/profile-errors.js";
import type { ProfileLocale } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { profileThumbnailKey } from "./profile-thumbnail-key";

const maximumBytes = 1_000_000;
/** One content/locale cache for manager capture and knob reads. Filenames are opaque hashes. */
export function createProfileThumbnailStore(root: string) {
	const path = (profile: Profile, locale: ProfileLocale) =>
		join(root, "thumbnails", `${profileThumbnailKey(profile, locale)}.png`);
	const decode = (bytes: Buffer): string => {
		if (
			bytes.length > maximumBytes ||
			!bytes
				.subarray(0, 8)
				.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
		)
			throw new RangeError("Invalid profile thumbnail");
		const image = nativeImage.createFromBuffer(bytes);
		const { width, height } = image.getSize();
		if (
			image.isEmpty() ||
			width <= 0 ||
			height <= 0 ||
			width * height > 64_000_000
		)
			throw new RangeError("Invalid profile thumbnail");
		return `data:image/png;base64,${bytes.toString("base64")}`;
	};
	return {
		read: async (
			profile: Profile,
			locale: ProfileLocale,
		): Promise<Option.Option<string>> => {
			try {
				const file = await open(path(profile, locale), "r");
				try {
					if ((await file.stat()).size > maximumBytes)
						throw new RangeError("Profile thumbnail too large");
					const bytes = Buffer.alloc(maximumBytes + 1);
					let length = 0;
					while (length < bytes.length) {
						const result = await file.read(
							bytes,
							length,
							bytes.length - length,
						);
						if (result.bytesRead === 0) break;
						length += result.bytesRead;
					}
					return Option.some(decode(bytes.subarray(0, length)));
				} finally {
					await file.close();
				}
			} catch (cause) {
				if (
					cause instanceof Error &&
					"code" in cause &&
					cause.code === "ENOENT"
				)
					return Option.none();
				throw ProfileThumbnailFailed.fromCause(cause);
			}
		},
		write: async (
			profile: Profile,
			locale: ProfileLocale,
			bytes: Buffer,
		): Promise<string> => {
			const temporary = `${path(profile, locale)}.${randomUUID()}.pending`;
			let failed = false;
			try {
				const data = decode(bytes);
				await mkdir(join(root, "thumbnails"), { recursive: true });
				await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
				await rename(temporary, path(profile, locale));
				return data;
			} catch (cause) {
				failed = true;
				throw ProfileThumbnailFailed.fromCause(cause);
			} finally {
				await unlink(temporary).catch((cause: unknown) => {
					if (
						!failed &&
						!(
							cause instanceof Error &&
							"code" in cause &&
							cause.code === "ENOENT"
						)
					)
						throw ProfileThumbnailFailed.fromCause(cause);
				});
			}
		},
	};
}
