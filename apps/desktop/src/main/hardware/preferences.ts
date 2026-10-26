import { createHash, randomUUID } from "node:crypto";
import {
	link,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
	canonicalHidSerial,
	HardwarePreferences,
	HardwarePreferencesFailed,
	HardwarePreferencesStore,
} from "@open-quake/device";
import { Effect, Layer, Option, Schema } from "effect";

const envelopeSchema = Schema.Struct({
	version: Schema.Literal(1),
	serial: Schema.String,
	preferences: HardwarePreferences,
});
const hasCode = (error: unknown, code: string): boolean =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	error.code === code;

export function hardwarePreferencesLive(
	root: string,
): Layer.Layer<HardwarePreferencesStore> {
	const file = (serial: string) =>
		join(root, `${createHash("sha256").update(serial).digest("hex")}.json`);
	const read = async (serial: string) => {
		let text: string;
		try {
			text = await readFile(file(serial), "utf8");
		} catch (error) {
			if (hasCode(error, "ENOENT")) return Option.none();
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
	};
	const write = async (
		serial: string,
		preferences: HardwarePreferences,
		replace: boolean,
	) => {
		const valid = Schema.decodeUnknownSync(HardwarePreferences)(preferences);
		await mkdir(root, { recursive: true });
		const target = file(serial);
		const staged = `${target}.${randomUUID()}.pending`;
		try {
			await writeFile(
				staged,
				JSON.stringify({ version: 1, serial, preferences: valid }),
				{ mode: 0o600 },
			);
			if (replace) await rename(staged, target);
			else {
				try {
					// Publish a complete inode without replacing a concurrent normalized save.
					await link(staged, target);
				} catch (error) {
					if (!hasCode(error, "EEXIST")) throw error;
				}
			}
		} finally {
			await rm(staged, { force: true });
		}
	};
	const legacyPreferences = async (serial: string) => {
		let names: string[];
		try {
			names = await readdir(root);
		} catch (error) {
			if (hasCode(error, "ENOENT")) return undefined;
			throw error;
		}
		let newest:
			| { preferences: HardwarePreferences; mtimeMs: number }
			| undefined;
		for (const name of names.sort()) {
			if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
			const path = join(root, name);
			let text: string;
			let mtimeMs: number;
			try {
				mtimeMs = (await stat(path)).mtimeMs;
				text = await readFile(path, "utf8");
			} catch {
				// Discovery spans other devices. Unreadable entries cannot establish a
				// matching legacy identity; the canonical read above still fails loudly.
				continue;
			}
			let input: unknown;
			try {
				input = JSON.parse(text);
			} catch {
				continue;
			}
			const decoded = Schema.decodeUnknownEither(envelopeSchema)(input);
			if (decoded._tag === "Left") continue;
			const envelope = decoded.right;
			if (
				envelope.serial === serial ||
				canonicalHidSerial(envelope.serial) !== serial ||
				file(envelope.serial) !== path
			)
				continue;
			if (!newest || mtimeMs > newest.mtimeMs)
				newest = { preferences: envelope.preferences, mtimeMs };
		}
		return newest?.preferences;
	};
	return Layer.succeed(HardwarePreferencesStore, {
		read: (serial) =>
			Effect.tryPromise({
				try: async () => {
					const current = await read(serial);
					if (Option.isSome(current) || canonicalHidSerial(serial) !== serial)
						return current;
					const legacy = await legacyPreferences(serial);
					if (!legacy) return current;
					await write(serial, legacy, false);
					// A racing save wins. Keep the legacy record as a recoverable source.
					return read(serial);
				},
				catch: (cause) => new HardwarePreferencesFailed(cause),
			}),
		write: (serial, preferences) =>
			Effect.tryPromise({
				try: () => write(serial, preferences, true),
				catch: (cause) => new HardwarePreferencesFailed(cause),
			}),
	});
}
