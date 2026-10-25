import type { AppLocale } from "./settings-contracts.js";
/** Only bundled locales can be suggested; OS metadata is never a saved override. */
export const resolveAppLocale = (locale: string): AppLocale =>
	/^de(?:[-_]|$)/i.test(locale) ? "de" : "en";
