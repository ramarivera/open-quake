import {
	regionModels,
	regionSuggestions,
} from "../../../../../../packages/edge/src/settings/region-invariants";
import { useLocaleText } from "../i18n";
export function RegionSuggestions({
	region,
}: {
	region: string;
}): React.JSX.Element | null {
	const t = useLocaleText("regionSuggestions");
	const models = regionModels(region);
	const suggestions = regionSuggestions(region);
	if (!models) return null;
	return (
		<aside className="setup-note" aria-label={t("title")}>
			<p>{t("advisory")}</p>
			<p>
				{t("chat")}: {suggestions.provider} · {models.chat}
			</p>
			<p>
				{t("speech")}: {suggestions.speech} · {models.stt} · {models.tts}
			</p>
			<p>
				{t("translation")}: {models.liveTranslation}
			</p>
		</aside>
	);
}
