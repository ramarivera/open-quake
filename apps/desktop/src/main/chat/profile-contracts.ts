import { Schema } from "effect";
import type { ProfileFunctionContract } from "../../../../../packages/device/src/profiles/profile-function-contracts";

const retainedActions = Schema.Array(
	Schema.Union(
		Schema.Struct({
			type: Schema.Literal("enableThinking", "enableSearch"),
			value: Schema.Boolean,
		}),
		Schema.Struct({
			type: Schema.Literal("roleConfig"),
			value: Schema.Struct({
				roleId: Schema.Int,
				rolePrompt: Schema.String.pipe(Schema.maxLength(3000)),
			}),
		}),
	),
);
/** Retained Copilot keys are validated by the same management registry as imported keys. */
export const assistantProfileContracts: ReadonlyMap<
	string,
	ProfileFunctionContract
> = new Map([
	[
		"aiChat",
		{
			childrenName: "aiChat",
			supportsKnob: false,
			supportsAlternateVisuals: true,
			validateConfig: (config) =>
				Schema.is(retainedActions, { onExcessProperty: "error" })(
					config.actions,
				)
					? []
					: [["actions"]],
		},
	],
]);
