import type { HardwareSession } from "@open-quake/device";
import { Effect, Either, Schema } from "effect";
import { HotkeyConfig } from "../../../../../packages/device/src/actions/action-contracts.js";
import { hardwareKeyboardAdapter } from "../../../../../packages/device/src/hardware/hardware-keyboard.js";
import {
	InvalidKnobConfig,
	KnobCapabilityUnavailable,
	KnobDispatchFailed,
	type KnobError,
	KnobSessionStale,
} from "../../../../../packages/device/src/knob/knob-errors.js";
import type { KnobModelPort } from "../../../../../packages/device/src/knob/model/ports.js";
import { committedFocusedKey, type FocusedKeyBindings } from "./focused-key";

/** Resolve from committed data, never from a renderer-supplied chord. */
export const focusedHotkey = (
	bindings: FocusedKeyBindings & {
		readonly hardware: () => HardwareSession | undefined;
	},
): KnobModelPort["focusedTurn"] => {
	const resolve = committedFocusedKey(bindings);
	return Effect.fn("DesktopKnob.focusedHotkey")(
		function* (key, delta, context): Effect.fn.Return<void, KnobError> {
			const session = bindings.hardware();
			const committed = yield* resolve(key, context);
			if (bindings.hardware() !== session)
				return yield* KnobSessionStale.fromCause();
			const config = Schema.decodeUnknownEither(HotkeyConfig)(committed.config);
			if (Either.isLeft(config))
				return yield* InvalidKnobConfig.fromCause(config.left);
			if (!config.right.supportKnob || !session)
				return yield* KnobCapabilityUnavailable.fromCause();
			const hardware = yield* session.snapshot();
			yield* resolve(key, context);
			if (
				bindings.hardware() !== session ||
				hardware.serial !== context.session.deviceId
			)
				return yield* KnobSessionStale.fromCause();
			if (!hardware.available)
				return yield* KnobCapabilityUnavailable.fromCause();
			yield* hardwareKeyboardAdapter(session)
				.pressChord(config.right.actions[delta === -1 ? 0 : 1].value)
				.pipe(
					Effect.matchEffect({
						onFailure: (cause) =>
							Effect.fail(KnobDispatchFailed.fromCause(cause)),
						onSuccess: () => Effect.void,
					}),
				);
		},
	);
};
