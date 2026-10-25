import { useAppLocale } from "../../i18n";
import dictionary from "./strings.json";

/** Namespace "agents": agent library, models, runtime and DK-Claw keys. */
export type AgentsCopy = (typeof dictionary)["en"];
export const agentsCopy = (locale = "en"): AgentsCopy =>
	locale === "de" ? dictionary.de : dictionary.en;
/** Pure default for non-React consumers and fixtures. */
export const agentsStrings: AgentsCopy = agentsCopy();

export const useAgentsCopy = (): AgentsCopy =>
	agentsCopy(useAppLocale().locale);
