import dictionary from "./strings.json";

/** Namespace "agents": agent library, models, runtime and DK-Claw keys. */
export type AgentsCopy = (typeof dictionary)["en"];
export const agentsCopy = (locale = "en"): AgentsCopy =>
	locale === "de" ? dictionary.de : dictionary.en;
/** English until the app locale provider is wired through this seam. */
export const agentsStrings: AgentsCopy = agentsCopy();
