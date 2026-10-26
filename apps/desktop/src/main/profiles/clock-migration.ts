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

export async function readLegacyClockConfiguration(
	root: string,
	envelope: EncodedProfileEnvelope,
): Promise<LegacyClockConfiguration> {
	const optional = async (path: string): Promise<unknown> => {
		try {
			return JSON.parse(await readFile(path, "utf8"));
		} catch (cause) {
			if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
				return undefined;
			throw cause;
		}
	};
	const raw = await optional(join(root, "clock-v1", "clock.json"));
	const clock =
		raw === undefined
			? undefined
			: Schema.decodeUnknownSync(ClockRecord, { onExcessProperty: "preserve" })(
					raw,
				);
	const formats = new Map<string, "12h" | "24h">();
	for (const serial of [
		...new Set([...Object.keys(envelope.activeByDevice), "desktop-preview"]),
	].sort()) {
		const hash = createHash("sha256").update(serial).digest("hex");
		let saved = await optional(
			join(root, "wallpaper-v1", "settings", `${hash}.json`),
		);
		if (saved === undefined)
			saved = await optional(
				join(root, "wallpaper-v1", "settings", `${hash}.backup.json`),
			);
		if (saved === undefined) continue;
		const value = Schema.decodeUnknownSync(SavedWallpaper)(saved);
		if (value.serial !== serial)
			throw new TypeError("Legacy wallpaper serial mismatch");
		formats.set(serial, value.clock.actions[0].value);
	}
	let names: string[];
	try {
		names = await readdir(join(root, "wallpaper-v1", "settings"));
	} catch (cause) {
		if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT"))
			throw cause;
		names = [];
	}
	for (const name of names
		.filter((name) => /^[a-f0-9]{64}(?:\.backup)?\.json$/.test(name))
		.sort(
			(a, b) =>
				Number(a.includes(".backup")) - Number(b.includes(".backup")) ||
				a.localeCompare(b),
		)) {
		const saved = await optional(join(root, "wallpaper-v1", "settings", name));
		if (saved === undefined) continue;
		const value = Schema.decodeUnknownSync(SavedWallpaper)(saved);
		const hash = createHash("sha256").update(value.serial).digest("hex");
		if (name !== `${hash}.json` && name !== `${hash}.backup.json`)
			throw new TypeError("Legacy wallpaper serial mismatch");
		if (!formats.has(value.serial))
			formats.set(value.serial, value.clock.actions[0].value);
	}
	return { clock, formats };
}

/** The atomic storage write is the only migration completion point. */
export async function loadProfileClockMigration(
	raw: unknown,
	root: string,
	write: (envelope: EncodedProfileEnvelope) => Promise<void>,
): Promise<EncodedProfileEnvelope> {
	const encoded = encodeProfileEnvelope(
		Schema.decodeUnknownSync(ProfileEnvelope)(raw),
	);
	if (encoded.clockConfigVersion === 1) return encoded;
	const migrated = migrateProfileClocks(
		encoded,
		await readLegacyClockConfiguration(root, encoded),
	);
	await write(migrated);
	return migrated;
}
