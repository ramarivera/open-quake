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
import { resolveModelRows } from "../../../../../../packages/edge/src/agents/agents-invariants";
import type { PublicModelRow } from "../../../shared/agents";

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
					...(type === "assistant"
						? { icon: "0-50", animations: ["0-47", "0-48", "0-49", "0-51"] }
						: {}),
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

/** Reflects capture readiness for the center direct-route assignment. */
export const knobVoiceReady = (
	knob: KnobResource,
	models: readonly PublicModelRow[],
): boolean => {
	const center = knob.config.subActions[0];
	const value = (type: string) =>
		center.config.actions.find((a) => a.type === type)?.value;
	return (
		center.config.type === "assistant" &&
		value("voiceRoute") === "direct" &&
		resolveModelRows(models).some(
			(m) =>
				m.id === value("directProvider") &&
				typeof value("directModel") === "string" &&
				String(value("directModel")).trim().length > 0 &&
				String(value("directModel")).length <= 200 &&
				m.credentialAvailable,
		)
	);
};

/** Grid-key-only saves advance the shared revision without changing a knob draft. */
export const knobDraftRevision = (
	baseline: Profile,
	latest: Profile,
): number =>
	baseline.id === latest.id &&
	latest.revision >= baseline.revision &&
	JSON.stringify(baseline.knob) === JSON.stringify(latest.knob)
		? latest.revision
		: baseline.revision;
