import { useAppLocale } from "../../i18n";

export { type AgentsCopy, agentsCopy } from "./locale-copy";

import { type AgentsCopy, agentsCopy } from "./locale-copy";
/** Pure default for non-React consumers and fixtures. */
export const agentsStrings: AgentsCopy = agentsCopy();

export const useAgentsCopy = (): AgentsCopy =>
	agentsCopy(useAppLocale().locale);
