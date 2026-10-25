import { Effect } from "effect";
import type { KnobError } from "../../../../../packages/device/src/knob/knob-errors.js";
import type { KnobModelPort } from "../../../../../packages/device/src/knob/model/ports.js";
import {
	type BrightnessAdapter,
	brightnessController,
} from "./brightness/controller";
import { committedFocusedKey, type FocusedKeyBindings } from "./focused-key";

export function focusedBrightness(
	bindings: FocusedKeyBindings,
	adapter: BrightnessAdapter,
): KnobModelPort["focusedTurn"] {
	const resolve = committedFocusedKey(bindings);
	const step = brightnessController(adapter);
	return Effect.fn("DesktopKnob.focusedBrightness")(
		(key, delta, context): Effect.Effect<void, KnobError> =>
			step(delta, resolve(key, context)),
	);
}
