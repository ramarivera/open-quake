import { useLocaleText } from "../i18n";
export const TRANSLATION_LANGUAGES = [
	"en",
	"zh",
	"ru",
	"fr",
	"de",
	"pt",
	"es",
	"it",
	"id",
	"ko",
	"ja",
	"vi",
	"th",
	"ar",
	"yue",
	"hi",
	"el",
	"tr",
] as const;
export function TranslationLanguageSelect({
	id,
	value,
	onChange,
}: {
	id?: string;
	value: string;
	onChange: (value: string) => void;
}): React.JSX.Element {
	const t = useLocaleText("translationLanguages");
	return (
		<select
			id={id}
			value={value}
			onChange={(event) => onChange(event.target.value)}
		>
			{!TRANSLATION_LANGUAGES.some((code) => code === value) ? (
				<option value={value}>{value}</option>
			) : null}
			{TRANSLATION_LANGUAGES.map((code) => (
				<option key={code} value={code}>
					{t(code)}
				</option>
			))}
		</select>
	);
}
