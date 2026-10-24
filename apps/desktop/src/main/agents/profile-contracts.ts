import { Schema } from "effect";
import type { ProfileFunctionContract } from "../../../../../packages/device/src/profiles/profile-function-contracts.js";
import { profileFunctionContractsLayer } from "../../../../../packages/device/src/profiles/profile-function-contracts.js";
import { AgentId } from "../../../../../packages/edge/src/agents/agents-contracts.js";
/** These three existing DK-Claw key renderers share the profile store. This map validates, never dispatches. */
export const agentProfileFunctionContracts: ReadonlyMap<
	string,
	ProfileFunctionContract
> = new Map([
	[
		"clawbot",
		{
			childrenName: "clawbot",
			supportsKnob: false,
			supportsAlternateVisuals: true,
			validateConfig: (config) => {
				const paths: (readonly (string | number)[])[] = [];
				const ids = config.actions.filter((a) => a.type === "agentId");
				if (ids.length !== 1 || !Schema.is(AgentId)(ids[0]?.value))
					paths.push(["actions", "agentId"]);
				for (const [index, action] of config.actions.entries())
					if (
						(action.type === "voiceInput" &&
							typeof action.value !== "boolean") ||
						(action.type === "taskPrompt" && typeof action.value !== "string")
					)
						paths.push(["actions", index, "value"]);
				return paths;
			},
		},
	],
	[
		"quakeBot",
		{
			childrenName: "ClawBotView",
			supportsKnob: false,
			supportsAlternateVisuals: true,
			validateConfig: (config) => {
				const ids = config.actions.filter((a) => a.type === "agentId");
				return ids.length === 1 && Schema.is(AgentId)(ids[0]?.value)
					? []
					: [["actions", "agentId"]];
			},
		},
	],
	[
		"quakeBotInput",
		{
			childrenName: "ClawBotInput",
			supportsKnob: false,
			supportsAlternateVisuals: true,
			validateConfig: (config) =>
				config.actions.length === 0 ? [] : [["actions"]],
		},
	],
]);
export const AgentProfileContractsLive = profileFunctionContractsLayer(
	agentProfileFunctionContracts,
);
