import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	HardwarePreferences,
	HardwarePreferencesFailed,
	HardwarePreferencesStore,
} from "@open-quake/device";
import { Effect, Layer, Option, Schema } from "effect";

export function hardwarePreferencesLive(
	root: string,
): Layer.Layer<HardwarePreferencesStore> {
	const file = (serial: string) =>
		join(root, `${createHash("sha256").update(serial).digest("hex")}.json`);
	return Layer.succeed(HardwarePreferencesStore, {
		read: (serial) =>
			Effect.tryPromise({
				try: async () => {
					let text: string;
					try {
						text = await readFile(file(serial), "utf8");
					} catch (error) {
						if (
							typeof error === "object" &&
							error !== null &&
							"code" in error &&
							error.code === "ENOENT"
						)
							return Option.none();
						throw error;
					}
					const envelope = Schema.decodeUnknownSync(
						Schema.Struct({
							version: Schema.Literal(1),
							serial: Schema.Literal(serial),
							preferences: HardwarePreferences,
						}),
					)(JSON.parse(text));
					return Option.some(envelope.preferences);
				},
				catch: (cause) => new HardwarePreferencesFailed(cause),
			}),
		write: (serial, preferences) =>
			Effect.tryPromise({
				try: async () => {
					const valid =
						Schema.decodeUnknownSync(HardwarePreferences)(preferences);
					await mkdir(root, { recursive: true });
					const target = file(serial);
					const staged = `${target}.${randomUUID()}.pending`;
					try {
						await writeFile(
							staged,
							JSON.stringify({ version: 1, serial, preferences: valid }),
							{ mode: 0o600 },
						);
						await rename(staged, target);
					} finally {
						await rm(staged, { force: true });
					}
				},
				catch: (cause) => new HardwarePreferencesFailed(cause),
			}),
	});
}
