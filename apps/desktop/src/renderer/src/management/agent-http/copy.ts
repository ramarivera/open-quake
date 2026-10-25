import dictionary from "./strings.json";

/** Namespace "agentHttp": runtime connections and conversations. */
export type RuntimeCopy = (typeof dictionary)["en"];
export const runtimeCopy = (locale = "en"): RuntimeCopy =>
	locale === "de" ? dictionary.de : dictionary.en;
/** English until the app locale provider is wired through this seam. */
export const runtimeStrings: RuntimeCopy = runtimeCopy();
