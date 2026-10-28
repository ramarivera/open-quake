import { GTProvider, initializeGT, useTranslations } from "gt-react";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { resolveAppLocale } from "../../../../../../packages/edge/src/settings/settings-invariants";
import audioSetup from "../../../shared/audio-setup-strings.json";
import type {
	AppLocale,
	AppLocaleBridge,
	LocaleSnapshot,
} from "../../../shared/locale";
import { APP_LANGUAGES } from "../../../shared/locale";
import agentHttp from "../management/agent-http/strings.json";
import { agentsCopy } from "../management/agents/locale-copy";
import chat from "../management/chat/strings.json";
import settings from "../settings/strings.json";
import wallpaper from "../wallpaper/strings.json";
import catalogErrors from "./catalog-errors.json";
import { localeFailureCode } from "./locale-error";
import recovered from "./recovered.json";

export { resolveAppLocale } from "../../../../../../packages/edge/src/settings/settings-invariants";
export type { AppLocale, AppLocaleBridge, LocaleSnapshot };

export type Dictionary = { readonly [key: string]: string | Dictionary };
export type AppDictionaries = Readonly<
	Record<"en", Dictionary> & Partial<Record<AppLocale, Dictionary>>
>;
export const appDictionaries: AppDictionaries = {
	en: {
		audioSetup: audioSetup.en,
		app: { language: "Language", english: "English", german: "German" },
		chat: chat.en,
		agentHttp: agentHttp.en,
		agents: agentsCopy("en"),
		settings: settings.en,
		wallpaper: wallpaper.en,
		...recovered.en,
	},
	de: {
		audioSetup: audioSetup.de,
		app: { language: "Sprache", english: "Englisch", german: "Deutsch" },
		chat: chat.de,
		agentHttp: agentHttp.de,
		agents: agentsCopy("de"),
		settings: settings.de,
		wallpaper: wallpaper.de,
		...recovered.de,
	},
	zh: { ...recovered.zh, agents: agentsCopy("zh") },
	es: { ...recovered.es, agents: agentsCopy("es") },
	fr: { ...recovered.fr, agents: agentsCopy("fr") },
	ko: { ...recovered.ko, agents: agentsCopy("ko") },
	it: { ...recovered.it, agents: agentsCopy("it") },
	ja: { ...recovered.ja, agents: agentsCopy("ja") },
};
// Bundled dictionaries only. Disable development translation requests even if
// the host environment happens to contain GT credentials.
initializeGT({
	defaultLocale: "en",
	locales: APP_LANGUAGES.map((entry) => entry.value),
	runtimeUrl: null,
	_disableDevHotReload: true,
	cacheExpiryTime: null,
	loadTranslations: async () => ({}),
	dictionary: appDictionaries.en,
	loadDictionary: async (locale) =>
		appDictionaries[resolveAppLocale(locale)] ?? appDictionaries.en,
});
const translations = Object.fromEntries(
	APP_LANGUAGES.map(({ value }) => [value, {}]),
);
const Context = createContext({
	locale: "en" as AppLocale,
	loading: false,
	error: "",
	setLocale: async (_locale: AppLocale): Promise<void> => {},
});
export const useAppLocale = () => useContext(Context);
export const useAppTranslations = useTranslations;
/** Small strip/native-style dictionaries also render in independent profile captures. */
export function useLocaleText(
	scope:
		| "clock"
		| "picker"
		| "regionSuggestions"
		| "translationLanguages"
		| "keysEditor",
	requestedLocale?: string,
): (key: string) => string {
	const appLocale = useAppLocale().locale;
	const locale = resolveAppLocale(requestedLocale ?? appLocale);
	const copy: Readonly<Record<string, string>> = recovered[locale][scope];
	const fallback: Readonly<Record<string, string>> = recovered.en[scope];
	return (key) => copy[key] ?? fallback[key] ?? key;
}

/** Catalog errors always resolve to localized human copy, including unknown codes. */
export function localizedCatalogError(
	code: string,
	requestedLocale: string,
): string {
	const locale = resolveAppLocale(requestedLocale);
	const messages = catalogErrors[locale] as Readonly<Record<string, string>>;
	return messages[code] ?? messages.generic ?? "The operation failed.";
}

/** Locale updates preserve the mounted app and all in-flight conversation state. */
export function AppLocaleProvider({
	children,
	bridge = window.quakeLocale,
	initialLocale = "en",
	bundled = appDictionaries,
}: {
	readonly children: ReactNode;
	readonly bridge?: AppLocaleBridge | null | undefined;
	readonly initialLocale?: AppLocale;
	readonly bundled?: AppDictionaries;
}) {
	const [snapshot, update] = useState<LocaleSnapshot>({
		locale: initialLocale,
		revision: -1,
	});
	const [loading, setLoading] = useState(Boolean(bridge));
	const [error, setError] = useState("");
	useEffect(() => {
		if (!bridge) return;
		let active = true;
		const receive = (next: LocaleSnapshot) => {
			if (active)
				update((current) =>
					next.revision >= current.revision
						? { ...next, locale: resolveAppLocale(next.locale) }
						: current,
				);
		};
		const off = bridge.subscribe(receive);
		void bridge
			.read()
			.then(receive)
			.catch((failure: unknown) => {
				if (active)
					setError(localeFailureCode(failure, "QUAKE.SETTINGS.READ_FAILED"));
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
			off();
		};
	}, [bridge]);
	const setLocale = async (locale: AppLocale) => {
		if (!bridge) {
			setError("QUAKE.SETTINGS.UNAVAILABLE");
			return;
		}
		try {
			const next = await bridge.set(locale);
			update((current) =>
				next.revision >= current.revision
					? { ...next, locale: resolveAppLocale(next.locale) }
					: current,
			);
			setError("");
		} catch (failure) {
			setError(localeFailureCode(failure, "QUAKE.SETTINGS.PERSIST_FAILED"));
		}
	};
	useEffect(() => {
		document.documentElement.lang = snapshot.locale;
	}, [snapshot.locale]);
	return (
		<Context.Provider
			value={{ locale: snapshot.locale, loading, error, setLocale }}
		>
			<GTProvider
				locale={snapshot.locale}
				translations={translations}
				dictionaries={bundled}
				_reload={(next) => {
					void setLocale(resolveAppLocale(next.locale));
				}}
			>
				{children}
			</GTProvider>
		</Context.Provider>
	);
}
