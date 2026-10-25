import { GTProvider, initializeGT, useTranslations } from "gt-react";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { resolveAppLocale } from "../../../../../../packages/edge/src/settings/settings-invariants";
import type {
	AppLocale,
	AppLocaleBridge,
	LocaleSnapshot,
} from "../../../shared/locale";
import agentHttp from "../management/agent-http/strings.json";
import agents from "../management/agents/strings.json";
import chat from "../management/chat/strings.json";

export { resolveAppLocale } from "../../../../../../packages/edge/src/settings/settings-invariants";
export type { AppLocale, AppLocaleBridge, LocaleSnapshot };

type Dictionary = { readonly [key: string]: string | Dictionary };
export type AppDictionaries = Readonly<Record<AppLocale, Dictionary>>;
export const appDictionaries: AppDictionaries = {
	en: {
		app: { language: "Language", english: "English", german: "German" },
		chat: chat.en,
		agentHttp: agentHttp.en,
		agents: agents.en,
	},
	de: {
		app: { language: "Sprache", english: "Englisch", german: "Deutsch" },
		chat: chat.de,
		agentHttp: agentHttp.de,
		agents: agents.de,
	},
};
// Bundled dictionaries only. Disable development translation requests even if
// the host environment happens to contain GT credentials.
initializeGT({
	defaultLocale: "en",
	locales: ["en", "de"],
	runtimeUrl: null,
	_disableDevHotReload: true,
	cacheExpiryTime: null,
	loadTranslations: async () => ({}),
	dictionary: appDictionaries.en,
	loadDictionary: async (locale) => appDictionaries[resolveAppLocale(locale)],
});
const translations = { en: {}, de: {} };
const Context = createContext({
	locale: "en" as AppLocale,
	loading: false,
	error: "",
	setLocale: async (_locale: AppLocale): Promise<void> => {},
});
export const useAppLocale = () => useContext(Context);
export const useAppTranslations = useTranslations;

/** Locale updates preserve the mounted app and all in-flight conversation state. */
export function AppLocaleProvider({
	children,
	bridge = window.quakeLocale,
	bundled = appDictionaries,
}: {
	readonly children: ReactNode;
	readonly bridge?: AppLocaleBridge | undefined;
	readonly bundled?: AppDictionaries;
}) {
	const [snapshot, update] = useState<LocaleSnapshot>({
		locale: "en",
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
					next.revision >= current.revision ? next : current,
				);
		};
		const off = bridge.subscribe(receive);
		void bridge
			.read()
			.then(receive)
			.catch(() => {
				if (active) setError("QUAKE.SETTINGS.READ_FAILED");
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
			update((current) => (next.revision >= current.revision ? next : current));
			setError("");
		} catch {
			setError("QUAKE.SETTINGS.PERSIST_FAILED");
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
