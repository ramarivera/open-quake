import type { ProfileFunctionContract } from "../profiles/profile-function-contracts.js";
import { validateAction } from "./action-invariants.js";
import { ACTION_REGISTRY } from "./action-registry.js";

/** Shared by import inspection and management dispatch validation. */
export const actionProfileFunctionContracts: ReadonlyMap<
	string,
	ProfileFunctionContract
> = new Map([
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
	// Folder navigation belongs to the profile editor rather than host actions.
	...(["createFolder", "emojiFolder", "back", "emojiBack"] as const).map(
		(id): [string, ProfileFunctionContract] => [
			id,
			{
				childrenName: id,
				supportsKnob: false,
				supportsAlternateVisuals: false,
				validateConfig: (config) => {
					const types =
						id === "createFolder"
							? ["folder", "page"]
							: id === "emojiFolder"
								? ["emojiFolderId", "page"]
								: ["parentFolder", "page"];
					const action = config.actions.find((action) =>
						types.includes(action.type),
					);
					return (id === "emojiBack" && config.actions.length === 0) ||
						(typeof action?.value === "string" && action.value.length > 0)
						? []
						: [["actions"]];
				},
			},
		],
	),
]);
