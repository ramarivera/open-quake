import { Either, Option, Schema } from "effect";
import {
	type KnobFunction,
	KnobNavigationActions,
	type KnobSlotName,
	KnobVoiceActions,
	PanelBrightnessActions,
} from "./knob-contracts.js";
import { InvalidKnobConfig } from "./knob-errors.js";

/** Validation is owned by each function's registry, including directional host actions. */
export interface KnobCapability {
	readonly id: string;
	readonly rotation: boolean;
	readonly press: boolean;
	readonly hold: boolean;
	readonly validate: (
		assignment: KnobFunction,
	) => Either.Either<void, InvalidKnobConfig>;
}
export type KnobRegistry = ReadonlyArray<KnobCapability>;
export const findKnobCapability = (
	registry: KnobRegistry,
	id: string,
): Option.Option<KnobCapability> =>
	Option.fromNullable(registry.find((c) => c.id === id));
/** Directional slots receive rotation only; center also receives press and hold. */
export const supportsKnobSlot = (
	capability: KnobCapability,
	slot: KnobSlotName,
): boolean =>
	capability.rotation ||
	(slot === "center" && (capability.press || capability.hold));
const validateOwned = (
	assignment: KnobFunction,
): Either.Either<void, InvalidKnobConfig> => {
	const { type, actions } = assignment.config;
	if (assignment.childrenName !== type)
		return Either.left(InvalidKnobConfig.fromCause("function-identity"));
	const valid =
		type === "assistant"
			? Schema.is(KnobVoiceActions)(actions)
			: type === "panelBrightness"
				? Schema.is(PanelBrightnessActions)(actions)
				: Schema.is(KnobNavigationActions)({ type, actions });
	return valid
		? Either.right(undefined)
		: Either.left(InvalidKnobConfig.fromCause("function-actions"));
};
/** Runtime availability is separate; these declarations do not enable adapters. */
export const KNOB_OWNED_CAPABILITIES: KnobRegistry = [
	{
		id: "previousPage",
		rotation: true,
		press: true,
		hold: false,
		validate: validateOwned,
	},
	{
		id: "nextPage",
		rotation: true,
		press: true,
		hold: false,
		validate: validateOwned,
	},
	{
		id: "goToPage",
		rotation: true,
		press: true,
		hold: false,
		validate: validateOwned,
	},
	{
		id: "panelBrightness",
		rotation: true,
		press: false,
		hold: false,
		validate: validateOwned,
	},
	{
		id: "assistant",
		rotation: false,
		press: false,
		hold: true,
		validate: validateOwned,
	},
];
