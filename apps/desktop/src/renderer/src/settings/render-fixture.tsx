import { GTProvider } from "gt-react";
import type { ReactNode } from "react";
import {
	type AppLocaleBridge,
	AppLocaleProvider,
	appDictionaries,
} from "../i18n";

/** Static render tests need both the locale owner and bundled translations. */
export function SettingsRenderFixture({
	app,
	locale,
	node,
}: {
	readonly app: AppLocaleBridge | null;
	readonly locale: "en" | "de";
	readonly node: ReactNode;
}) {
	return (
		<AppLocaleProvider bridge={app}>
			<GTProvider
				locale={locale}
				translations={{ en: {}, de: {} }}
				dictionaries={appDictionaries}
				_reload={() => {}}
			>
				{node}
			</GTProvider>
		</AppLocaleProvider>
	);
}
