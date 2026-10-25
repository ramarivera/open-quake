import { useAppLocale } from "../../i18n";
import dictionary from "./strings.json";

/** Namespace "agentHttp": runtime connections and conversations. */
export type RuntimeCopy = (typeof dictionary)["en"];
export const runtimeCopy = (locale = "en"): RuntimeCopy =>
	locale === "de" ? dictionary.de : dictionary.en;
/** Pure default for non-React consumers and fixtures. */
export const runtimeStrings: RuntimeCopy = runtimeCopy();

export const useRuntimeCopy = (): RuntimeCopy =>
	runtimeCopy(useAppLocale().locale);
