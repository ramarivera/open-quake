import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { safeStorage } from "electron";
import type {
	CredentialVault,
	JsonStore,
} from "../../../../../packages/edge/src/channels/channel-contracts";
import { CredentialFailed } from "../../../../../packages/edge/src/channels/integration-errors";
export const fileStore = (
	root: string,
	name: string,
	initial: unknown,
): JsonStore => ({
	read: async () => {
		try {
			const raw = await readFile(join(root, name), "utf8");
			if (raw.length > 8 * 1024 * 1024) throw new RangeError();
			return JSON.parse(raw);
		} catch (cause) {
			if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
				return initial;
			throw cause;
		}
	},
	write: async (value) => {
		await mkdir(root, { recursive: true, mode: 0o700 });
		const pending = join(root, `${name}.${randomUUID()}.pending`);
		try {
			await writeFile(pending, JSON.stringify(value), {
				mode: 0o600,
				flag: "wx",
			});
			await rename(pending, join(root, name));
		} finally {
			await unlink(pending).catch((cause) => {
				if (
					!(
						cause instanceof Error &&
						"code" in cause &&
						cause.code === "ENOENT"
					)
				)
					throw cause;
			});
		}
	},
});
/** safeStorage uses the OS credential store for its encryption key. Plaintext/basic_text is refused. */
export const systemCredentialVault = (root: string): CredentialVault => {
	const check = () => {
		if (
			!safeStorage.isEncryptionAvailable() ||
			(process.platform === "linux" &&
				safeStorage.getSelectedStorageBackend() === "basic_text")
		)
			throw new CredentialFailed();
	};
	const path = (reference: string) => {
		if (!/^[0-9a-f-]{36}$/.test(reference)) throw new CredentialFailed();
		return join(root, reference);
	};
	return {
		put: async (value) => {
			check();
			const reference = randomUUID();
			await mkdir(root, { recursive: true, mode: 0o700 });
			await writeFile(path(reference), safeStorage.encryptString(value), {
				flag: "wx",
				mode: 0o600,
			});
			return reference;
		},
		get: async (reference) => {
			check();
			return safeStorage.decryptString(await readFile(path(reference)));
		},
		remove: async (reference) => {
			await unlink(path(reference)).catch((cause) => {
				if (
					!(
						cause instanceof Error &&
						"code" in cause &&
						cause.code === "ENOENT"
					)
				)
					throw cause;
			});
		},
	};
};
