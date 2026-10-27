import { BackupFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { exportBackup } from "./backup-store";
import { replaceBackup } from "./backup-write";

export const BACKUP_EXPORT_TIMEOUT = 120_000;

/** The native save dialog finishes before this deadline starts. Late work can't publish. */
export async function exportBackupTo(
	root: string,
	destination: string,
	appearance: () => Promise<string>,
	caller: AbortSignal,
): Promise<void> {
	const controller = new AbortController();
	let committing = false;
	const cancel = () => {
		if (!committing) controller.abort(caller.reason);
	};
	caller.addEventListener("abort", cancel, { once: true });
	if (caller.aborted) cancel();
	const signal = controller.signal;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let aborted: (() => void) | undefined;
	try {
		signal.throwIfAborted();
		await Promise.race([
			new Promise<never>((_resolve, reject) => {
				aborted = () => reject(new BackupFailed(signal.reason));
				signal.addEventListener("abort", aborted, { once: true });
				timer = setTimeout(
					() => controller.abort(new Error("Backup export timed out")),
					BACKUP_EXPORT_TIMEOUT,
				);
			}),
			(async () => {
				const record = await appearance();
				signal.throwIfAborted();
				const bytes = await exportBackup(root, signal, record);
				signal.throwIfAborted();
				await replaceBackup(destination, bytes, signal, () => {
					committing = true;
					clearTimeout(timer);
					if (aborted) signal.removeEventListener("abort", aborted);
				});
			})(),
		]);
	} finally {
		clearTimeout(timer);
		caller.removeEventListener("abort", cancel);
		if (aborted) signal.removeEventListener("abort", aborted);
	}
}
