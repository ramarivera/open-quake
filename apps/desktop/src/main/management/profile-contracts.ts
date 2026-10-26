import { Schema } from "effect";
import { actionProfileFunctionContracts } from "../../../../../packages/device/src/actions/profile-function-contracts";
import {
	type ProfileFunctionContract,
	profileFunctionContractsLayer,
} from "../../../../../packages/device/src/profiles/profile-function-contracts";
import { HaKey } from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import { agentProfileFunctionContracts } from "../agents/profile-contracts";
import { monitorProfileContracts } from "../monitor/profile-contracts";
/** One validation registry for the management-owned profile consumers. No action dispatch here. */
export const managementProfileContracts = new Map<
	string,
	ProfileFunctionContract
>([
	...actionProfileFunctionContracts,
	...monitorProfileContracts,
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
