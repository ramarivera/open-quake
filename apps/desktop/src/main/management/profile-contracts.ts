import { Schema } from "effect";
import { validateAction } from "../../../../../packages/device/src/actions/action-invariants";
import { ACTION_REGISTRY } from "../../../../../packages/device/src/actions/action-registry";
import {
	type ProfileFunctionContract,
	profileFunctionContractsLayer,
} from "../../../../../packages/device/src/profiles/profile-function-contracts";
import { HaKey } from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import { agentProfileFunctionContracts } from "../agents/profile-contracts";
/** One validation registry for the management-owned profile consumers. No action dispatch here. */
export const managementProfileContracts = new Map<
	string,
	ProfileFunctionContract
>([
	...ACTION_REGISTRY.filter((entry) => entry.binding !== "unresolved").map(
		(entry): [string, ProfileFunctionContract] => [
			entry.id,
			{
				childrenName: entry.id,
				supportsKnob: entry.supportKnob,
				supportsAlternateVisuals: entry.alternateState,
				validateConfig: (config) =>
					validateAction(entry.id, config)._tag === "Right"
						? []
						: [["actions"]],
			},
		],
	),
	...agentProfileFunctionContracts,
	[
		"homeAssistant",
		{
			childrenName: "homeAssistant",
			supportsKnob: false,
			supportsAlternateVisuals: false,
			validateConfig: (config) => {
				const action = config.actions.find((a) => a.type === "configData");
				if (!action || typeof action.value !== "string") return [["actions"]];
				try {
					return Schema.is(HaKey)(JSON.parse(action.value))
						? []
						: [["actions"]];
				} catch {
					return [["actions"]];
				}
			},
		},
	],
]);
export const ManagementProfileContractsLive = profileFunctionContractsLayer(
	managementProfileContracts,
);
