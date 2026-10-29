/** Cleanup must run after finalization failure, and either failure rejects success. */
export async function finishGuidedCapture(
	finalization: Promise<void> | undefined,
	close: () => Promise<void> | undefined,
	code: number,
): Promise<number> {
	try {
		await finalization;
	} catch {
		code = 1;
	}
	try {
		await close();
	} catch {
		code = 1;
	}
	return code;
}
