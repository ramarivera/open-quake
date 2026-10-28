import dictionary from "./strings.json";

/** Namespace "agents": agent library, models, runtime and Agent keys. */
export type AgentsCopy = (typeof dictionary)["en"];
export const agentsCopy = (locale = "en"): AgentsCopy => {
	const translated =
		dictionary[locale as keyof typeof dictionary] ?? dictionary.en;
	return {
		...dictionary.en,
		...translated,
		clawAgentManagement: {
			...dictionary.en.clawAgentManagement,
			...translated.clawAgentManagement,
		},
		clawAIConfig: { ...dictionary.en.clawAIConfig, ...translated.clawAIConfig },
		openclawRuntimeIndicator: {
			...dictionary.en.openclawRuntimeIndicator,
			...translated.openclawRuntimeIndicator,
		},
		dkclaw: { ...dictionary.en.dkclaw, ...translated.dkclaw },
		keyFields: { ...dictionary.en.keyFields, ...translated.keyFields },
	};
};
