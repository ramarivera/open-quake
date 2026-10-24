import { lstat, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { BackupInvalid } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import {
	defaultAppearance,
	parseAppearance,
} from "../../renderer/src/theme/appearance";

export function appearanceRecord(value: unknown): string {
	const parsed =
		value === null
			? defaultAppearance
			: typeof value === "string"
				? parseAppearance(value)
				: null;
	if (!parsed) throw new BackupInvalid();
	return JSON.stringify(parsed);
}

/** A restored record waits here until the real localStorage consumer confirms persistence. */
export async function pendingAppearance(
	root: string,
): Promise<string | undefined> {
	const path = join(root, "appearance.json");
	const info = await lstat(path).catch((cause: unknown) => {
		if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
			return undefined;
		throw cause;
	});
	if (!info) return undefined;
	if (!info.isFile() || info.isSymbolicLink() || info.size > 20480)
		throw new BackupInvalid();
	return appearanceRecord(await readFile(path, "utf8"));
}
export async function acknowledgeAppearance(
	root: string,
	record: string,
): Promise<void> {
	const expected = appearanceRecord(record);
	if ((await pendingAppearance(root)) === expected)
		await rm(join(root, "appearance.json"));
}
