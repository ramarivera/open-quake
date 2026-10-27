import { useAppLocale } from "../i18n";
import strings from "./strings.json";

export type HardwareTextKey = keyof typeof strings.en;
export function useHardwareText(): (key: HardwareTextKey) => string {
	const { locale } = useAppLocale();
	return (key) => strings[locale][key];
}
