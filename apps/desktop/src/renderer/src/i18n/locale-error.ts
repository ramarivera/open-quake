/** Preserve only locale catalog identities, with the existing operation fallback. */
export function localeFailureCode(error: unknown, fallback: string): string {
	if (typeof error !== "object" || error === null || !("code" in error))
		return fallback;
	const code = error.code;
	return code === "QUAKE.SETTINGS.INVALID" ||
		code === "QUAKE.SETTINGS.READ_FAILED" ||
		code === "QUAKE.SETTINGS.PERSIST_FAILED" ||
		code === "QUAKE.SETTINGS.UNAVAILABLE"
		? code
		: fallback;
}
