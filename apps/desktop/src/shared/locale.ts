import type {
	AppLocale,
	LocaleSnapshot,
} from "../../../../packages/edge/src/settings/settings-contracts";

export type { AppLocale, LocaleSnapshot };
export const APP_LANGUAGES: ReadonlyArray<{ value: AppLocale; label: string }> =
	[
		{ value: "zh", label: "中文" },
		{ value: "en", label: "English" },
		{ value: "es", label: "Español" },
		{ value: "fr", label: "Français" },
		{ value: "ko", label: "한국어" },
		{ value: "de", label: "Deutsch" },
		{ value: "it", label: "Italiano" },
		{ value: "ja", label: "日本語" },
	];
export const WIZARD_LANGUAGES = APP_LANGUAGES.map((entry) =>
	entry.value === "zh" ? { ...entry, label: "简体中文" } : entry,
);

export const LOCALE_REQUEST = "settings:locale:rpc";
export const LOCALE_CHANGED = "settings:locale:changed";
export interface AppLocaleBridge {
	readonly read: () => Promise<LocaleSnapshot>;
	readonly set: (locale: AppLocale) => Promise<LocaleSnapshot>;
	readonly subscribe: (
		receive: (snapshot: LocaleSnapshot) => void,
	) => () => void;
	readonly dispose: () => Promise<void>;
}
declare global {
	interface Window {
		readonly quakeLocale?: AppLocaleBridge;
	}
}
