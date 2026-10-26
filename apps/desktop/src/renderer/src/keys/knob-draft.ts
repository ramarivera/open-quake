import { Either, Option } from "effect";
import type {
	KnobResource,
	KnobSlot,
	KnobSlotName,
} from "../../../../../../packages/device/src/knob/knob-contracts.js";
import {
	emptyKnobResource,
	emptyKnobSlot,
	migrateKnobResource,
	replaceKnobSlot,
} from "../../../../../../packages/device/src/knob/knob-invariants.js";
import type { Profile } from "../../../../../../packages/device/src/profiles/profile-contracts.js";

export const profileKnobDraft = (profile: Profile): KnobResource => {
	if (Option.isNone(profile.knob)) return emptyKnobResource();
	const migrated = migrateKnobResource(profile.knob.value);
	return Either.isRight(migrated)
		? migrated.right.resource
		: emptyKnobResource();
};
export const knobAssignment = (type: string): KnobSlot =>
	type === ""
		? emptyKnobSlot()
		: {
				childrenName: type,
				config: {
					type,
					actions:
						type === "assistant"
							? [
									{ type: "voiceRoute", value: "direct" },
									{ type: "directProvider", value: "" },
									{ type: "directModel", value: "" },
								]
							: type === "panelBrightness"
								? [{ type: "stepPercent", value: 5 }]
								: type === "goToPage"
									? [{ type: "page", value: 1 }]
									: [],
				},
			};
export const editKnobSlot = (
	knob: KnobResource,
	name: KnobSlotName,
	slot: KnobSlot,
): KnobResource => ({
	...knob,
	config: {
		...knob.config,
		subActions: replaceKnobSlot(knob.config.subActions, name, slot),
	},
});
