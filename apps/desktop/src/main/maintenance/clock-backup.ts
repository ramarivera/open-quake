import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
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
import { backupLimits } from "./backup-archive";

/** Read only a clock-selected regular file, with no symlink components and a bounded allocation. */
async function selectedBytes(
	path: string,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	if (!isAbsolute(path)) throw new BackupFailed();
	const selected = await lstat(path);
	if (!selected.isFile()) throw new BackupFailed();
	let current = resolve(path);
	while (true) {
		const info = await lstat(current);
		if (info.isSymbolicLink() || (current === resolve(path) && !info.isFile()))
			throw new BackupFailed();
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	const file = await open(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const before = await file.stat();
		if (
			!before.isFile() ||
			before.dev !== selected.dev ||
			before.ino !== selected.ino ||
			before.size > backupLimits.entry
		)
			throw new BackupFailed();
		const bytes = Buffer.alloc(before.size + 1);
		let length = 0;
		while (length < bytes.length) {
			signal?.throwIfAborted();
			const chunk = await file.read(bytes, length, bytes.length - length, null);
			if (!chunk.bytesRead) break;
			length += chunk.bytesRead;
		}
		const after = await file.stat();
		if (
			length !== before.size ||
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs
		)
			throw new BackupFailed();
		return bytes.subarray(0, length);
	} finally {
		await file.close();
	}
}

/** Archive the slots used by the clock consumer, never neighbouring files or unrelated path strings. */
export async function archiveClockMedia(
	files: Map<string, Uint8Array>,
	root: string,
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
		let total = [...files.values()].reduce(
			(sum, value) => sum + value.length,
			0,
		);
		for (const id of THEME_IDS) {
			const slot = themes[id];
			if (!slot) continue;
			if (mediaKindOfPath(slot.path) !== slot.kind) throw new BackupFailed();
			const content = await selectedBytes(slot.path, signal);
			const hash = createHash("sha256").update(content).digest("hex");
			const relative = `clock-v1/assets/${hash}${extname(slot.path).toLowerCase()}`;
			const entry = `open-quake/${relative}`;
			total += files.has(entry) ? 0 : content.length;
			if (
				total > backupLimits.total ||
				(!files.has(entry) && files.size >= backupLimits.entries)
			)
				throw new BackupFailed();
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
