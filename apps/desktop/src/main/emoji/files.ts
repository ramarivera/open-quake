import { createHash, randomUUID } from "node:crypto";
import {
	link,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { EmojiStore } from "../../../../../packages/edge/src/emoji/emoji-contracts";
import { decodeGif } from "../../shared/gif";

const absent = (cause: unknown): boolean =>
	cause instanceof Error && "code" in cause && cause.code === "ENOENT";
const exists = (cause: unknown): boolean =>
	cause instanceof Error && "code" in cause && cause.code === "EEXIST";
const decodeStore = Schema.decodeUnknownSync(EmojiStore, {
	onExcessProperty: "error",
});
type StoreFile =
	| { readonly kind: "absent" }
	| { readonly kind: "invalid"; readonly cause: unknown }
	| {
			readonly kind: "valid";
			readonly contents: string;
			readonly value: EmojiStore;
	  };

export function emojiFiles(root: string) {
	const file = join(root, "library.json");
	const backupFile = join(root, "library.backup.json");
	const assetPath = (hash: string): string => {
		if (!/^[a-f0-9]{64}$/.test(hash))
			throw new RangeError("Invalid asset reference");
		return join(root, "assets", hash);
	};
	const inspect = async (path: string): Promise<StoreFile> => {
		let contents: string;
		try {
			contents = await readFile(path, "utf8");
		} catch (cause) {
			if (absent(cause)) return { kind: "absent" };
			// Permission/device failures are not missing or malformed data.
			throw cause;
		}
		try {
			const raw: unknown = JSON.parse(contents);
			return { kind: "valid", contents, value: decodeStore(raw) };
		} catch (cause) {
			return { kind: "invalid", cause };
		}
	};
	const read = async (): Promise<EmojiStore | null> => {
		const primary = await inspect(file);
		if (primary.kind === "valid") return primary.value;
		const backup = await inspect(backupFile);
		if (backup.kind === "valid") return backup.value;
		// Keep invalid files intact, and let the repository translate this original cause.
		if (primary.kind === "invalid") throw primary.cause;
		if (backup.kind === "invalid") throw backup.cause;
		return null;
	};
	const write = async (value: EmojiStore): Promise<void> => {
		const contents = JSON.stringify(decodeStore(value));
		await mkdir(root, { recursive: true });
		const temp = `${file}.${randomUUID()}.part`;
		try {
			await writeFile(temp, contents, { mode: 0o600, flag: "wx" });
			const previous = await inspect(file);
			// After backup recovery the primary may still be malformed. Never rotate
			// those bytes over the valid backup that made recovery possible.
			if (previous.kind === "valid") {
				const backup = `${temp}.backup`;
				try {
					await writeFile(backup, previous.contents, {
						mode: 0o600,
						flag: "wx",
					});
					await rename(backup, backupFile);
				} finally {
					await rm(backup, { force: true }).catch(() => undefined);
				}
			}
			await rename(temp, file);
		} finally {
			// Rename is the commit point. Cleanup must not report an already-committed save as failed.
			await rm(temp, { force: true }).catch(() => undefined);
		}
	};
	const put = async (bytes: Uint8Array): Promise<string> => {
		// Snapshot before the first await so caller mutation cannot change a hash's contents.
		const contents = Buffer.from(bytes);
		const hash = createHash("sha256").update(contents).digest("hex");
		const directory = join(root, "assets");
		await mkdir(directory, { recursive: true });
		const temp = join(directory, `.${hash}.${randomUUID()}.part`);
		try {
			await writeFile(temp, contents, { mode: 0o600, flag: "wx" });
			try {
				// A hard link publishes completed bytes atomically and never replaces an existing asset.
				await link(temp, assetPath(hash));
			} catch (cause) {
				if (!exists(cause)) throw cause;
				await get(hash); // Verify a concurrent/existing publication; never repair it by overwriting.
			}
			return hash;
		} finally {
			await rm(temp, { force: true }).catch(() => undefined);
		}
	};
	const get = async (hash: string): Promise<Buffer> => {
		const bytes = await readFile(assetPath(hash));
		if (createHash("sha256").update(bytes).digest("hex") !== hash)
			throw new RangeError("Changed asset");
		return bytes;
	};
	const verifiedGifs = new Set<string>();
	const clipboardPath = async (hash: string): Promise<string> => {
		const bytes = await get(hash);
		if (!verifiedGifs.has(hash)) {
			decodeGif(bytes);
			verifiedGifs.add(hash);
		}
		const directory = join(root, "clipboard");
		await mkdir(directory, { recursive: true });
		const destination = join(directory, `${hash}.gif`);
		const temp = join(directory, `.${randomUUID()}.part`);
		try {
			await writeFile(temp, bytes, { mode: 0o600, flag: "wx" });
			try {
				await link(temp, destination);
			} catch (cause) {
				if (!exists(cause)) throw cause;
			}
			const published = await readFile(destination);
			if (createHash("sha256").update(published).digest("hex") !== hash)
				throw new RangeError("Changed clipboard asset");
			return destination;
		} finally {
			await rm(temp, { force: true }).catch(() => undefined);
		}
	};
	const collect = async (profileHashes: readonly string[]): Promise<void> => {
		const live = new Set(profileHashes);
		const primary = await inspect(file);
		if (primary.kind === "absent") return;
		if (primary.kind !== "valid")
			throw new RangeError("Collection needs a valid committed library.");
		for (const asset of primary.value.staticAssets) live.add(asset.hash);
		for (const item of primary.value.items) {
			live.add(item.original);
			live.add(item.rendered);
		}
		// Checkpoint the validated primary before removing assets from the previous backup.
		const checkpoint = `${backupFile}.${randomUUID()}.part`;
		try {
			await writeFile(checkpoint, primary.contents, {
				mode: 0o600,
				flag: "wx",
			});
			await rename(checkpoint, backupFile);
		} finally {
			await rm(checkpoint, { force: true }).catch(() => {});
		}

		// Clipboard publications outlive library/profile references and app restarts.
		// Defer their collection until native clipboard ownership can be observed.
		// Source assets remain independently reclaimable.
		for (const directory of ["assets"]) {
			const names = await readdir(join(root, directory)).catch(
				(cause: unknown) => {
					if (absent(cause)) return [];
					throw cause;
				},
			);
			for (const name of names) {
				const hash = name.replace(/\.gif$/, "");
				if (/^[a-f0-9]{64}$/.test(hash) && !live.has(hash)) {
					await rm(join(root, directory, name));
					verifiedGifs.delete(hash);
				}
			}
		}
	};
	return { read, write, put, get, assetPath, clipboardPath, collect };
}
