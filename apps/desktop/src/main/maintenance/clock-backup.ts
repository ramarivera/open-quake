import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import { Schema } from "effect";
import {
	encodeProfileEnvelope,
	ProfileAction,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { BackupFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import {
	type ClockAction,
	mediaKindOfPath,
	normalizeClockStyle,
	THEME_IDS,
} from "../../shared/clock-style";
import { ClockRecord } from "../clock/clock-store";
import type { BackupFiles, BackupReadBudget } from "./backup-budget";
import { readBackupFile } from "./backup-read";

/** Archive the slots used by the clock consumer, never neighbouring files or unrelated path strings. */
export async function archiveClockMedia(
	files: BackupFiles,
	root: string,
	budget: BackupReadBudget,
	signal?: AbortSignal,
): Promise<void> {
	try {
		const archiveActions = async (
			actions: readonly ClockAction[],
		): Promise<readonly ClockAction[]> => {
			const result: ClockAction[] = [];
			for (const action of actions) {
				if (action.type !== "clockStyle") {
					result.push(action);
					continue;
				}
				const normalized = normalizeClockStyle(action.value);
				const themes = { ...normalized.background.themes };
				if (!Object.keys(themes).length) {
					result.push(action);
					continue;
				}
				for (const id of THEME_IDS) {
					const slot = themes[id];
					if (!slot) continue;
					if (mediaKindOfPath(slot.path) !== slot.kind)
						throw new BackupFailed();
					const content = await readBackupFile(slot.path, budget, signal);
					const hash = createHash("sha256").update(content).digest("hex");
					const relative = `clock-v1/assets/${hash}${extname(slot.path).toLowerCase()}`;
					const entry = `open-quake/${relative}`;
					files.set(entry, content);
					themes[id] = { kind: slot.kind, path: join(root, relative) };
				}
				const value = Schema.decodeUnknownSync(
					Schema.Record({ key: Schema.String, value: Schema.Unknown }),
				)(action.value);
				const background = Schema.decodeUnknownSync(
					Schema.Record({ key: Schema.String, value: Schema.Unknown }),
				)(value.background ?? {});
				const { source: _legacy, ...rest } = background;
				const replacement = {
					...value,
					background: { ...rest, ...normalized.background, themes },
				};
				result.push({ ...action, value: replacement });
			}
			return result;
		};
		const profileName = "open-quake/profiles-v1.json";
		const profileBytes = files.get(profileName);
		const envelope = profileBytes
			? encodeProfileEnvelope(
					Schema.decodeUnknownSync(ProfileEnvelope)(
						JSON.parse(Buffer.from(profileBytes).toString("utf8")),
					),
				)
			: undefined;

		const legacyName = "open-quake/clock-v1/clock.json";
		const legacyBytes = files.get(legacyName);
		if (envelope?.clockConfigVersion === 1) {
			// Legacy slots are abandoned after migration and may point at deleted files.
			files.delete(legacyName);
		} else if (legacyBytes) {
			const record = Schema.decodeUnknownSync(ClockRecord, {
				onExcessProperty: "preserve",
			})(JSON.parse(Buffer.from(legacyBytes).toString("utf8")));
			const keys = [];
			for (const key of record.keys)
				keys.push(
					key.config.type !== "dkDesktopClock"
						? key
						: {
								...key,
								config: {
									...key.config,
									actions: await archiveActions(key.config.actions),
								},
							},
				);
			files.set(legacyName, Buffer.from(JSON.stringify({ ...record, keys })));
		}
		if (envelope) {
			const profiles = [];
			for (const profile of envelope.profiles) {
				const pages = [];
				for (const page of profile.pages) {
					const keys = [];
					for (const key of page.keys)
						keys.push(
							key.config.type !== "dkDesktopClock"
								? key
								: {
										...key,
										config: {
											...key.config,
											actions: Schema.decodeUnknownSync(
												Schema.Array(ProfileAction),
											)(await archiveActions(key.config.actions ?? [])),
										},
									},
						);
					pages.push({ ...page, keys });
				}
				profiles.push({ ...profile, pages });
			}
			files.set(
				profileName,
				Buffer.from(JSON.stringify({ ...envelope, profiles })),
			);
		}
	} catch (cause) {
		throw cause instanceof BackupFailed ? cause : new BackupFailed(cause);
	}
}
