import type { ProfileFunctionContract } from "../profiles/profile-function-contracts.js";
import { validateAction } from "./action-invariants.js";
import { ACTION_REGISTRY } from "./action-registry.js";

/** Shared by import inspection and management dispatch validation. */
export const actionProfileFunctionContracts: ReadonlyMap<
	string,
	ProfileFunctionContract
> = new Map(
	ACTION_REGISTRY.filter((entry) => entry.binding !== "unresolved").map(
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
);
