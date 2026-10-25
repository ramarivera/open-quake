import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer, Option } from "effect";
import {
	SettingsPersistFailed,
	SettingsReadFailed,
} from "../../../../../packages/edge/src/settings/settings-errors";
import { SettingsStorage } from "../../../../../packages/edge/src/settings/settings-repository";
export function desktopSettingsStorage(directory: string, osLocale: string) {
	const path = join(directory, "settings-v1.json");
	return Layer.succeed(SettingsStorage, {
		osLocale,
		read: Effect.tryPromise({
			try: async () => {
				try {
					if ((await stat(path)).size > 65536) throw new SettingsReadFailed();
					const text = await readFile(path, "utf8");
					if (Buffer.byteLength(text) > 65536) throw new SettingsReadFailed();
					return Option.some(JSON.parse(text) as unknown);
				} catch (cause) {
					if (
						cause instanceof Error &&
						"code" in cause &&
						cause.code === "ENOENT"
					)
						return Option.none();
					throw cause;
				}
			},
			catch: (cause) => new SettingsReadFailed(cause),
		}),
		write: (document) =>
			Effect.tryPromise({
				try: async () => {
					const text = JSON.stringify(document);
					if (Buffer.byteLength(text) > 65536)
						throw new SettingsPersistFailed();
					await mkdir(directory, { recursive: true, mode: 0o700 });
					const temporary = join(directory, `.settings-${randomUUID()}.json`);
					let committed = false;
					try {
						const file = await open(temporary, "wx", 0o600);
						try {
							await file.writeFile(text, "utf8");
							await file.sync();
						} finally {
							await file.close();
						}
						await rename(temporary, path);
						committed = true;
					} finally {
						if (!committed) await unlink(temporary).catch(() => undefined);
					}
				},
				catch: (cause) => new SettingsPersistFailed(cause),
			}),
	});
}
