import { Either, Option } from "effect";
import type {
	KnobDispatchCommand,
	KnobSession,
	KnobSnapshot,
} from "./knob-contracts.js";
import { findKnobCapability, type KnobRegistry } from "./knob-registry.js";

export const sameKnobSession = (a: KnobSession, b: KnobSession): boolean =>
	a.deviceId === b.deviceId &&
	a.sessionId === b.sessionId &&
	a.profileId === b.profileId &&
	a.revision === b.revision;
/** Select one route, without consulting adapter availability or executing side effects. */
export function selectKnobRotation(
	snapshot: KnobSnapshot,
	direction: "counterclockwise" | "clockwise",
	registry: KnobRegistry,
): Option.Option<KnobDispatchCommand> {
	const index = direction === "counterclockwise" ? 0 : 1;
	const focused = snapshot.focused;
	if (
		Option.isSome(focused) &&
		focused.value.visible &&
		focused.value.supportKnob
	) {
		const directions = focused.value.directions;
		const valid = directions.every((assignment) => {
			const capability = findKnobCapability(registry, assignment.config.type);
			return (
				Option.isSome(capability) &&
				capability.value.rotation &&
				Either.isRight(capability.value.validate(assignment))
			);
		});
		if (valid)
			return Option.some({
				session: snapshot.session,
				route: "focused",
				assignment: directions[index],
				activation: "rotate",
				direction,
			});
	}
	// Idle rotation belongs to KnobModel profile selection. Saved slots are inert.
	return Option.none();
}
