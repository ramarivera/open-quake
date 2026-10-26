import { Either } from "effect";
import type { ActionHostAdapters } from "./action-adapters.js";
import { InvalidKeyAction, KeyFunctionUnavailable } from "./action-errors.js";
import {
	type ActionAvailability,
	type ActionConfig,
	type ActionEntry,
	findAction,
} from "./action-registry.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Selects only executable fields. Layout/artwork/timing stay with their owning contracts. */
export function validateAction(
	id: string,
	input: unknown,
): Either.Either<ActionConfig, InvalidKeyAction | KeyFunctionUnavailable> {
	const entry = findAction(id);
	if (!entry)
		return Either.left(new KeyFunctionUnavailable("unknown-function"));
	if (entry.binding === "unresolved")
		return Either.left(new KeyFunctionUnavailable("unresolved"));
	if (!isRecord(input)) return Either.left(new InvalidKeyAction("config"));
	if (input.type !== id)
		return Either.left(new InvalidKeyAction("config.type"));
	if (input.supportKnob !== undefined && typeof input.supportKnob !== "boolean")
		return Either.left(new InvalidKeyAction("config.supportKnob"));
	if (input.supportKnob === true && !entry.supportKnob)
		return Either.left(new InvalidKeyAction("config.supportKnob"));
	if (
		Array.isArray(input.actions) &&
		input.actions.some(
			(action: unknown) =>
				!isRecord(action) ||
				Object.keys(action).some((key) => key !== "type" && key !== "value"),
		)
	)
		return Either.left(new InvalidKeyAction("config.actions"));
	const decoded = entry.decode(input);
	if (decoded._tag === "Left")
		return Either.left(new InvalidKeyAction("config.actions", decoded.left));
	return Either.right(decoded.right);
}

export function actionAvailability(
	entry: ActionEntry,
	adapters: ActionHostAdapters["Type"],
): ActionAvailability {
	switch (entry.binding) {
		case "unresolved":
			return "unresolved";
		case "delegate":
			return "unsupported-on-platform";
		case "website":
			return adapters.website._tag === "Some"
				? "available"
				: "unsupported-on-platform";
		case "hotkey":
			return adapters.keyboard._tag === "Some"
				? "available"
				: "unsupported-on-platform";
		case "text":
			return adapters.text._tag === "Some"
				? "available"
				: "unsupported-on-platform";
		case "open":
			return adapters.application._tag === "Some"
				? "available"
				: "unsupported-on-platform";
		case "media":
			return adapters.media._tag === "Some" &&
				("mediaCommand" in entry
					? adapters.media.value.supportedCommands.has(entry.mediaCommand)
					: entry.id === "mute"
						? adapters.media.value.supportedCommands.has("audio_mute")
						: entry.id === "vol"
							? adapters.media.value.supportedCommands.has("audio_vol_down") &&
								adapters.media.value.supportedCommands.has("audio_vol_up")
							: adapters.media.value.supportedCommands.size > 0)
				? "available"
				: "unsupported-on-platform";
	}
}
