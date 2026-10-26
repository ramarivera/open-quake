import { Option, Schema } from "effect";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog";
import {
	type Profile,
	ProfileEnvelope,
	ProfileKeyConfig,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { ProfileWriteFailed } from "../../../../../packages/device/src/profiles/profile-errors";
import type { ProfileStoragePort } from "../../../../../packages/device/src/profiles/profile-repository";

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
): typeof ProfileEnvelope.Encoded | undefined {
	const parsed = Schema.decodeUnknownEither(ProfileEnvelope)(input);
	if (parsed._tag === "Left") return;
	const envelope = parsed.right;
	let changed = false;
	const panel = builtinProfiles("linux").find((p) => p.id === "1-3");
	if (!panel) return;
	const profiles = envelope.profiles.map((p): Profile => {
		const metadata = Option.getOrUndefined(p.compatibility);
		const keys = p.pages[0].keys;
		if (
			p.id !== "1-3" ||
			p.revision !== 0 ||
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
			revision: p.revision + 1,
			pages: [{ ...p.pages[0], keys: panel.pages[0].keys }],
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
): ProfileStoragePort => ({
	...storage,
	read: async () => {
		const raw = await storage.read(),
			next = migrateMonitorProfile(raw);
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
