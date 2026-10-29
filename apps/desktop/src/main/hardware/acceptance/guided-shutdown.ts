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
/** A renderer that stops painting must not hold capture shutdown open forever. */
export async function boundedCaptureWait<T>(
	pending: Promise<T>,
	timeoutMs = 5000,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			pending,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("Guided renderer wait timed out")),
					timeoutMs,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
