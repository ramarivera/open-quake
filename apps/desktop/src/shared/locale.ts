import type {
	AppLocale,
	LocaleSnapshot,
} from "../../../../packages/edge/src/settings/settings-contracts";

export type { AppLocale, LocaleSnapshot };
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
