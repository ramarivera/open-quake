import { Option, Schema } from "effect";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog";
import {
	type Profile,
	ProfileEnvelope,
	type ProfileKey,
	ProfileKeyConfig,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { ProfileWriteFailed } from "../../../../../packages/device/src/profiles/profile-errors";
import type { ProfileStoragePort } from "../../../../../packages/device/src/profiles/profile-repository";

import {
	MonitorRecord,
	type MonitorSettings,
} from "../../shared/monitor-contracts";
import {
	monitorKeySettings,
	withMonitorKeySettings,
} from "../../shared/monitor-key-settings";

const legacyTypes = [
	"cpuInfo",
	"gpuInfo",
	"memInfo",
	"diskInfo",
	"processInfo",
	"networkInfo",
	"powerInfo",
	"bluetoothInfo",
];
/** Only the installed catalog's untouched grid qualifies. User copies and edits survive. */
export function migrateMonitorProfile(
	input: unknown,
	legacySettings?: MonitorSettings,
): typeof ProfileEnvelope.Encoded | undefined {
	const parsed = Schema.decodeUnknownEither(ProfileEnvelope)(input);
	if (parsed._tag === "Left") return;
	const envelope = parsed.right;
	let changed = false;
	const panel = builtinProfiles("linux").find((p) => p.id === "1-3");
	if (!panel) return;
	const present = (key: ProfileKey): ProfileKey => {
		if (
			!legacySettings ||
			key.config.temperatureUnit !== undefined ||
			!["systemMonitorPanel", "cpuInfo", "gpuInfo"].includes(key.config.type)
		)
			return key;
		const canonical = panel.pages[0].keys[0]?.config.actions;
		const untouched =
			key.config.actions.length === 0 ||
			JSON.stringify(key.config.actions) === JSON.stringify(canonical);
		const settings = untouched
			? legacySettings
			: monitorKeySettings(key, legacySettings);
		return {
			...withMonitorKeySettings(key, settings),
			compatibility: Option.some({
				...Option.getOrUndefined(key.compatibility),
				monitorPresentationMigrated: true,
			}),
		};
	};
	const profiles = envelope.profiles.map((original): Profile => {
		let p = original;
		const pages = p.pages.map((page) => ({
			...page,
			keys: page.keys.map(present),
		}));
		if (
			pages.some((page, i) =>
				page.keys.some((key, j) => key !== p.pages[i]?.keys[j]),
			)
		) {
			changed = true;
			p = {
				...p,
				revision: p.revision + 1,
				pages: [pages[0] ?? p.pages[0], ...pages.slice(1)],
			};
		}
		const metadata = Option.getOrUndefined(original.compatibility);
		const keys = original.pages[0].keys;
		if (
			p.id !== "1-3" ||
			original.revision !== 0 ||
			metadata?.builtin !== "systemMonitor" ||
			p.pages.length !== 1 ||
			keys.length !== legacyTypes.length
		)
			return p;
		const untouched =
			legacyTypes.every(
				(type) => keys.filter((key) => key.config.type === type).length === 1,
			) &&
			keys.every((key) => {
				const source = Option.getOrUndefined(key.compatibility)?.source;
				const raw = Schema.decodeUnknownEither(
					Schema.Struct({ keyCode: Schema.String, config: Schema.Unknown }),
				)(source);
				if (raw._tag === "Left" || raw.right.keyCode !== key.keyCode)
					return false;
				const original = Schema.decodeUnknownEither(ProfileKeyConfig)(
					raw.right.config,
				);
				return (
					original._tag === "Right" &&
					JSON.stringify(Schema.encodeSync(ProfileKeyConfig)(key.config)) ===
						JSON.stringify(Schema.encodeSync(ProfileKeyConfig)(original.right))
				);
			});
		if (!untouched) return p;
		changed = true;
		return {
			...p,
			revision: original.revision + 1,
			pages: [
				{
					...p.pages[0],
					keys: panel.pages[0].keys.map((key) =>
						legacySettings ? withMonitorKeySettings(key, legacySettings) : key,
					),
				},
			],
		};
	});
	return changed
		? Schema.encodeSync(ProfileEnvelope)({
				...envelope,
				profiles: [profiles[0] ?? envelope.profiles[0], ...profiles.slice(1)],
			})
		: undefined;
}
export const monitorProfileStorage = (
	storage: ProfileStoragePort,
	loadMonitor: () => Promise<unknown> = async () => undefined,
): ProfileStoragePort => ({
	...storage,
	read: async () => {
		const raw = await storage.read();
		const saved = Schema.decodeUnknownEither(MonitorRecord)(
			await loadMonitor(),
		);
		const next = migrateMonitorProfile(
			raw,
			saved._tag === "Right" && saved.right.revision > 0
				? saved.right.settings
				: undefined,
		);
		if (!next) return raw;
		await storage.write(next);
		const verified = await storage.read();
		if (JSON.stringify(verified) !== JSON.stringify(next))
			throw ProfileWriteFailed.fromCause(
				new Error("Monitor migration readback mismatch"),
			);
		return verified;
	},
});
