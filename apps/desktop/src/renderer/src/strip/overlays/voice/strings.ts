import {
	STRIP_LOCALES,
	STRIP_STRINGS,
	type StripLocale,
	type StripStringKey,
} from "./strings-table";

export type { StripLocale, StripStringKey };

/** The renderer language mapped to one of DK's eight locales; English otherwise. */
export function stripLocale(language: string | undefined): StripLocale {
	const prefix = (language ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
	return STRIP_LOCALES.find((locale) => locale === prefix) ?? "en";
}

/** DK's vue-i18n `{name}` interpolation; values are display text, never markup. */
export function stripText(
	locale: StripLocale,
	key: StripStringKey,
	params: Readonly<Record<string, string | number>> = {},
): string {
	const template: string = STRIP_STRINGS[locale][key];
	return template.replace(/\{(\w+)\}/g, (match, name: string) => {
		const value = params[name];
		return value === undefined ? match : String(value);
	});
}
