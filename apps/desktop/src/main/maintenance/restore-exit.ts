import { RestoreFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";

/** Once shutdown starts, main reports the result and exits even if a window or commit is lost. */
export async function restoreAndExit(options: {
	readonly validate: () => Promise<void>;
	readonly stop: () => Promise<void>;
	readonly commit: () => Promise<{
		readonly skipped: number;
		readonly imported: number;
	}>;
	readonly report: (message: string) => Promise<unknown>;
	readonly exit: (code: number) => void;
}): Promise<void> {
	await options.validate();
	let code = 1;
	try {
		await options.stop();
		const result = await options.commit();
		code = 0;
		await options
			.report(
				`Import Success (${result.skipped} skipped, ${result.imported} imported). Reopen open-quake.`,
			)
			.catch(() => undefined);
	} catch (cause) {
		const error = new RestoreFailed(cause);
		await options
			.report(
				`Import could not finish (${error.code}). Reopen open-quake. The original data was retained if replacement failed.`,
			)
			.catch(() => undefined);
		throw error;
	} finally {
		options.exit(code);
	}
}
