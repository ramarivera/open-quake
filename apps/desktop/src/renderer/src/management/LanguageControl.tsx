import { type AppLocale, useAppLocale, useAppTranslations } from "../i18n";
import { Segmented } from "../ui/Form";

/** Languages are always offered in their own name, never translated. */
const languages: ReadonlyArray<{ value: AppLocale; label: string }> = [
	{ value: "en", label: "English" },
	{ value: "de", label: "Deutsch" },
];

const failures: Readonly<Record<string, string>> = {
	"QUAKE.SETTINGS.READ_FAILED": "The saved language could not be read.",
	"QUAKE.SETTINGS.PERSIST_FAILED": "The language could not be saved.",
	"QUAKE.SETTINGS.UNAVAILABLE": "Language settings are unavailable here.",
};

export function useLanguageLabel(): string {
	return useAppTranslations("app")("language");
}

/** The app-wide language, saved by main and applied to every window. */
export function LanguageControl({
	name,
	labelledBy,
}: {
	name: string;
	labelledBy: string;
}): React.JSX.Element {
	const { locale, setLocale, loading, error } = useAppLocale();
	return (
		<>
			<Segmented
				name={name}
				labelledBy={labelledBy}
				value={locale}
				options={languages}
				disabled={loading}
				onChange={(next) => void setLocale(next)}
			/>
			{error ? (
				<span className="mc-language-error" role="alert">
					{failures[error] ?? "The language could not be changed."}
				</span>
			) : null}
		</>
	);
}
