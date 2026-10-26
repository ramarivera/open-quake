import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Array as EffectArray, Schema } from "effect";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	type EncodedProfileEnvelope,
	encodeProfileEnvelope,
	ProfileAction,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ClockConfigInvalid } from "../../shared/clock-errors";
import { SavedWallpaper } from "../../shared/display";
import { ClockRecord } from "../clock/clock-store";

const preset = builtinProfiles("darwin")
	.flatMap((p) => p.pages.flatMap((page) => page.keys))
	.find((k) => k.config.type === "dkDesktopClock");

export interface LegacyClockConfiguration {
	readonly clock: typeof ClockRecord.Type | undefined;
	readonly formats: ReadonlyMap<string, "12h" | "24h">;
}

/** Pure migration. A marker is committed with the data, never before it. */
export function migrateProfileClocks(
	envelope: EncodedProfileEnvelope,
	legacy: LegacyClockConfiguration,
): EncodedProfileEnvelope {
	if (envelope.clockConfigVersion === 1) return envelope;
	return {
		...envelope,
		clockConfigVersion: 1,
		profiles: EffectArray.map(envelope.profiles, (profile) => {
			let changed = false;
			const serials = Object.keys(envelope.activeByDevice)
				.filter(
					(serial) =>
						serial !== "desktop-preview" &&
						envelope.activeByDevice[serial]?.profileId === profile.id,
				)
				.sort();
			const hourFormat =
				[...serials, "desktop-preview", ...[...legacy.formats.keys()].sort()]
					.map((serial) => legacy.formats.get(serial))
					.find((value) => value !== undefined) ?? "24h";
			const pages = EffectArray.map(profile.pages, (page) => ({
				...page,
				keys: page.keys.map((key) => {
					if (key.config.type !== "dkDesktopClock") return key;
					const old = legacy.clock?.keys.find(
						(k) =>
							k.keyCode === key.keyCode && k.config.type === "dkDesktopClock",
					);
					let actions = [...(key.config.actions ?? [])];
					for (const type of ["hourFormat", "clockStyle", "showSeconds"]) {
						const existing = actions.find((a) => a.type === type);
						const fallback = preset?.config.actions.find(
							(a) => a.type === type,
						) ?? { type, value: false };
						const source =
							type === "hourFormat"
								? { type, value: hourFormat }
								: (old?.config.actions.find((a) => a.type === type) ??
									fallback);
						if (
							existing &&
							JSON.stringify(existing.value) !== JSON.stringify(fallback.value)
						)
							continue;
						// Decode legacy unknown values into the profile's JSON contract.
						const value = Schema.decodeUnknownSync(ProfileAction)(source);
						actions = existing
							? actions.map((a) => (a.type === type ? value : a))
							: [...actions, value];
					}
					if (
						JSON.stringify(actions) === JSON.stringify(key.config.actions ?? [])
					)
						return key;
					changed = true;
					return { ...key, config: { ...key.config, actions } };
				}),
			}));
			return changed
				? { ...profile, revision: profile.revision + 1, pages }
				: profile;
		}),
	};
}

export type ClockMigrationDiagnostic = (error: ClockConfigInvalid) => void;
const logDiagnostic: ClockMigrationDiagnostic = (error) => {
	process.stderr.write(`${JSON.stringify(error)}\n`);
};

/** Both disk migration and archive import use the same primary/backup validation. */
export function legacyClockConfiguration(
	files: ReadonlyMap<string, string>,
	report: ClockMigrationDiagnostic = logDiagnostic,
): LegacyClockConfiguration {
	const decode = <T>(
		name: string,
		validate: (raw: unknown) => T,
	): T | undefined => {
		const raw = files.get(name);
		if (raw === undefined) return undefined;
		try {
			return validate(JSON.parse(raw));
		} catch (cause) {
			report(ClockConfigInvalid.fromCause(cause));
			return undefined;
		}
	};
	const clock = decode(
		"clock-v1/clock.json",
		Schema.decodeUnknownSync(ClockRecord, { onExcessProperty: "preserve" }),
	);
	const formats = new Map<string, "12h" | "24h">();
	const primaries = [
		...new Set(
			[...files.keys()]
				.filter((name) =>
					/^wallpaper-v1\/settings\/[a-f0-9]{64}(?:\.backup)?\.json$/.test(
						name,
					),
				)
				.map((name) => name.replace(".backup.json", ".json")),
		),
	].sort();
	for (const name of primaries) {
		const validate = (raw: unknown) => {
			const value = Schema.decodeUnknownSync(SavedWallpaper)(raw);
			const hash = createHash("sha256").update(value.serial).digest("hex");
			if (name !== `wallpaper-v1/settings/${hash}.json`)
				throw new TypeError("Legacy wallpaper serial mismatch");
			return value;
		};
		const saved =
			decode(name, validate) ??
			decode(name.replace(".json", ".backup.json"), validate);
		if (saved) formats.set(saved.serial, saved.clock.actions[0].value);
	}
	return { clock, formats };
}

export async function readLegacyClockConfiguration(
	root: string,
	envelope: EncodedProfileEnvelope,
	report: ClockMigrationDiagnostic = logDiagnostic,
): Promise<LegacyClockConfiguration> {
	const missing = (cause: unknown) =>
		cause instanceof Error && "code" in cause && cause.code === "ENOENT";
	const files = new Map<string, string>();
	const read = async (name: string) => {
		try {
			files.set(name, await readFile(join(root, name), "utf8"));
		} catch (cause) {
			if (!missing(cause)) report(ClockConfigInvalid.fromCause(cause));
		}
	};
	const names = new Set<string>();
	for (const serial of [
		...Object.keys(envelope.activeByDevice),
		"desktop-preview",
	]) {
		const hash = createHash("sha256").update(serial).digest("hex");
		names.add(`${hash}.json`);
		names.add(`${hash}.backup.json`);
	}
	try {
		for (const name of await readdir(join(root, "wallpaper-v1/settings")))
			if (/^[a-f0-9]{64}(?:\.backup)?\.json$/.test(name)) names.add(name);
	} catch (cause) {
		if (!missing(cause)) report(ClockConfigInvalid.fromCause(cause));
	}
	await read("clock-v1/clock.json");
	for (const name of [...names].sort())
		await read(`wallpaper-v1/settings/${name}`);
	return legacyClockConfiguration(files, report);
}

/** The atomic storage write is the only migration completion point. */
export async function loadProfileClockMigration(
	raw: unknown,
	root: string,
	write: (envelope: EncodedProfileEnvelope) => Promise<void>,
	report: ClockMigrationDiagnostic = logDiagnostic,
): Promise<EncodedProfileEnvelope> {
	const encoded = encodeProfileEnvelope(
		Schema.decodeUnknownSync(ProfileEnvelope)(raw),
	);
	if (encoded.clockConfigVersion === 1) return encoded;
	const migrated = migrateProfileClocks(
		encoded,
		await readLegacyClockConfiguration(root, encoded, report),
	);
	await write(migrated);
	return migrated;
}
