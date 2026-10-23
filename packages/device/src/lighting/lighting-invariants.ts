import { Either, Option, Schema } from "effect";
import {
	LightingCapabilities,
	LightingChange,
	type LightingFieldCapability,
	type LightingIdentity,
	type LightingState,
	type LightingTarget,
} from "./lighting-contracts.js";
import {
	InvalidLightingValue,
	LightingTargetUnavailable,
	LightingValueUnsupported,
} from "./lighting-errors.js";

export const sameTarget = (a: LightingTarget, b: LightingTarget): boolean =>
	a.serial === b.serial && a.session === b.session;
export const sameIdentity = (
	a: LightingIdentity,
	b: LightingIdentity,
): boolean =>
	a.firmware === b.firmware && a.protocolVersion === b.protocolVersion;

export function validateCapabilities(
	target: LightingTarget,
	input: unknown,
): Either.Either<LightingCapabilities, LightingTargetUnavailable> {
	const decoded = Schema.decodeUnknownEither(LightingCapabilities)(input);
	if (Either.isLeft(decoded))
		return Either.left(new LightingTargetUnavailable(decoded.left));
	const caps = decoded.right;
	if (
		!sameTarget(target, caps.target) ||
		(caps.transport === "legacy" && caps.identity.protocolVersion >= 11) ||
		(caps.transport === "unavailable" &&
			(caps.fields.length > 0 || Option.isSome(caps.save))) ||
		new Set(caps.fields.map((f) => f.field)).size !== caps.fields.length ||
		new Set(caps.fields.map((f) => f.valueId)).size !== caps.fields.length ||
		caps.fields.some(
			(f) =>
				!sameIdentity(f.evidence.identity, caps.identity) ||
				(f.writable && !f.readable),
		) ||
		(Option.isSome(caps.save) &&
			!sameIdentity(caps.save.value.evidence.identity, caps.identity))
	) {
		return Either.left(new LightingTargetUnavailable());
	}
	return Either.right(caps);
}

const inRange = (
	value: number,
	range: { readonly min: number; readonly max: number },
): boolean => value >= range.min && value <= range.max;

export function valueFits(
	cap: LightingFieldCapability,
	change: LightingChange,
): boolean {
	if (cap.field !== change.field) return false;
	if (typeof change.value === "number") {
		if (cap.field === "effect") return cap.effectIds.includes(change.value);
		return (
			(cap.field === "brightness" || cap.field === "effectSpeed") &&
			inRange(change.value, cap.range)
		);
	}
	return (
		(cap.field === "color1" || cap.field === "color2") &&
		inRange(change.value.hue, cap.hue) &&
		inRange(change.value.saturation, cap.saturation)
	);
}

export function validateChange(
	caps: LightingCapabilities,
	input: unknown,
): Either.Either<
	LightingChange,
	InvalidLightingValue | LightingValueUnsupported
> {
	const decoded = Schema.decodeUnknownEither(LightingChange)(input);
	if (Either.isLeft(decoded))
		return Either.left(new InvalidLightingValue(decoded.left));
	const change = decoded.right;
	const cap = caps.fields.find((f) => f.field === change.field);
	if (!cap?.writable) return Either.left(new LightingValueUnsupported());
	return valueFits(cap, change)
		? Either.right(change)
		: Either.left(new InvalidLightingValue());
}

export const changeBytes = (change: LightingChange): readonly number[] =>
	typeof change.value === "number"
		? [change.value]
		: [change.value.hue, change.value.saturation];
export const sameChange = (a: LightingChange, b: LightingChange): boolean =>
	a.field === b.field &&
	changeBytes(a).every((byte, i) => byte === changeBytes(b)[i]);
export const replaceChange = (
	values: readonly LightingChange[],
	change: LightingChange,
): readonly LightingChange[] => [
	...values.filter((v) => v.field !== change.field),
	change,
];
export const sameValues = (
	a: readonly LightingChange[],
	b: readonly LightingChange[],
): boolean =>
	a.length === b.length &&
	a.every((v) => b.some((other) => sameChange(v, other)));

export function reconcileSaveStatus(
	state: LightingState,
	hasPendingEdits: boolean,
): LightingState {
	if (state.saveStatus === "failed") return state;
	return {
		...state,
		saveStatus: Option.isNone(state.saved)
			? "unknown"
			: !hasPendingEdits &&
					sameValues(state.desired, state.applied) &&
					sameValues(state.saved.value, state.applied)
				? "saved"
				: "unsaved",
	};
}
