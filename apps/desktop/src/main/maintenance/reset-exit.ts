import { ResetFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";

/** Once confirmed shutdown starts, a renderer can no longer own reset failure reporting. */
export async function resetAndExit(options: {
	readonly stop: () => Promise<void>;
	readonly clear: () => Promise<void>;
	readonly report: (message: string) => Promise<unknown>;
	readonly exit: (code: number) => void | Promise<void>;
}): Promise<void> {
	let code = 1;
	try {
		await options.stop();
		await options.clear();
		code = 0;
	} catch (cause) {
		const error = new ResetFailed(cause);
		await options
			.report(
				`Clear data could not finish (${error.code}). Reopen open-quake. Data was retained if shutdown or replacement failed.`,
			)
			.catch(() => undefined);
		throw error;
	} finally {
		await options.exit(code);
	}
}
