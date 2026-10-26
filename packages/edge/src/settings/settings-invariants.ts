import { AppLocale } from "./settings-contracts.js";
/** OS metadata suggests a bundled locale once; unknown values use English. */
export const resolveAppLocale = (locale: string): AppLocale => {
	const primary = locale.trim().toLowerCase().split(/[-_]/)[0];
	return AppLocale.literals.find((supported) => supported === primary) ?? "en";
};
