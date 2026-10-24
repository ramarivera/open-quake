import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import { Schema } from "effect";
import { BackupFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import {
	CLOCK_KEY_CODE,
	isClockKey,
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
	const name = "open-quake/clock-v1/clock.json";
	const bytes = files.get(name);
	if (!bytes) return;
	try {
		const record = Schema.decodeUnknownSync(ClockRecord, {
			onExcessProperty: "preserve",
		})(JSON.parse(Buffer.from(bytes).toString("utf8")));
		const key = record.keys.find(
			(key) => key.keyCode === CLOCK_KEY_CODE && isClockKey(key),
		);
		const action = key?.config.actions.find(
			(action) => action.type === "clockStyle",
		);
		if (!action) return;
		const normalized = normalizeClockStyle(action.value);
		const themes = { ...normalized.background.themes };
		if (!Object.keys(themes).length) return;
		for (const id of THEME_IDS) {
			const slot = themes[id];
			if (!slot) continue;
			if (mediaKindOfPath(slot.path) !== slot.kind) throw new BackupFailed();
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
		files.set(
			name,
			Buffer.from(
				JSON.stringify({
					...record,
					keys: record.keys.map((item) =>
						item === key
							? {
									...item,
									config: {
										...item.config,
										actions: item.config.actions.map((item) =>
											item === action ? { ...item, value: replacement } : item,
										),
									},
								}
							: item,
					),
				}),
			),
		);
	} catch (cause) {
		throw cause instanceof BackupFailed ? cause : new BackupFailed(cause);
	}
}
