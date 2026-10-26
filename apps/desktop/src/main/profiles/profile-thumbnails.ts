import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Option } from "effect";
import { nativeImage } from "electron";
import type { Profile } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileThumbnailFailed } from "../../../../../packages/device/src/profiles/profile-errors.js";
import type { ProfileLocale } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { profileThumbnailKey } from "./profile-thumbnail-key";
import { pruneProfileThumbnails } from "./profile-thumbnail-retention";

const maximumBytes = 1_000_000;
/** One content/locale cache for manager capture and knob reads. Filenames are opaque hashes. */
export function createProfileThumbnailStore(root: string) {
	let tail: Promise<void> = Promise.resolve();
	const serialize = <A>(operation: () => Promise<A>): Promise<A> => {
		const next = tail.then(operation);
		tail = next.then(
			() => {},
			() => {},
		);
		return next;
	};
	const path = (profile: Profile, locale: ProfileLocale) =>
		join(root, "thumbnails", `${profileThumbnailKey(profile, locale)}.png`);
	const decode = (bytes: Buffer): Option.Option<string> => {
		// Bound decompression before nativeImage allocates a bitmap from untrusted cache bytes.
		if (
			bytes.length > maximumBytes ||
			bytes.length < 33 ||
			!bytes
				.subarray(0, 8)
				.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
			bytes.readUInt32BE(8) !== 13 ||
			bytes.toString("ascii", 12, 16) !== "IHDR"
		)
			return Option.none();
		const width = bytes.readUInt32BE(16);
		const height = bytes.readUInt32BE(20);
		if (width === 0 || height === 0 || width * height > 4_000_000)
			return Option.none();
		try {
			const image = nativeImage.createFromBuffer(bytes);
			const size = image.getSize();
			if (image.isEmpty() || size.width !== width || size.height !== height)
				return Option.none();
			return Option.some(`data:image/png;base64,${bytes.toString("base64")}`);
		} catch {
			// Only native decoding is recoverable here. Filesystem errors stay typed below.
			return Option.none();
		}
	};
	return {
		prune: (profiles: readonly Profile[]): Promise<void> =>
			serialize(() =>
				pruneProfileThumbnails(join(root, "thumbnails"), profiles),
			),
		read: async (
			profile: Profile,
			locale: ProfileLocale,
		): Promise<Option.Option<string>> => {
			try {
				const file = await open(path(profile, locale), "r");
				try {
					if ((await file.stat()).size > maximumBytes) return Option.none();
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
					return decode(bytes.subarray(0, length));
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
		write: (
			profile: Profile,
			locale: ProfileLocale,
			bytes: Buffer,
		): Promise<string> =>
			serialize(async () => {
				const temporary = `${path(profile, locale)}.${randomUUID()}.pending`;
				let failed = false;
				try {
					const decoded = decode(bytes);
					if (Option.isNone(decoded))
						throw new RangeError("Invalid profile thumbnail");
					const data = decoded.value;
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
			}),
	};
}
