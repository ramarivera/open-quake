/** Diagnostics must never turn a failed smoke into a successful exit. */
export async function reportSmokeFailure(
	cause: unknown,
	diagnostics: () => Promise<void>,
): Promise<void> {
	process.exitCode = 1;
	process.stderr.write(`${String(cause)}\n`);
	try {
		await diagnostics();
	} catch (diagnosticCause) {
		process.stderr.write(
			`Smoke diagnostics failed: ${String(diagnosticCause)}\n`,
		);
	}
}
