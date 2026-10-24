import { Effect, Option } from "effect";
import type { KeyboardActionAdapter } from "../actions/action-adapters.js";
import {
	type HostActionError,
	HostActionFailed,
} from "../actions/action-errors.js";
import { deviceKeyboardTokens } from "./hardware-invariants.js";
import type { HardwareSession } from "./hardware-service.js";

/** Bind this adapter to ActionHostAdapters.keyboard. Device is the launch default. */
export function hardwareKeyboardAdapter(
	session: HardwareSession,
	host: Option.Option<KeyboardActionAdapter> = Option.none(),
): KeyboardActionAdapter {
	return {
		supportedTokens: new Set([
			...deviceKeyboardTokens,
			...Option.match(host, {
				onNone: () => [],
				onSome: (adapter) => [...adapter.supportedTokens],
			}),
		]),
		pressChord: Effect.fn("HardwareKeyboard.pressChord")(function* (
			chord: string,
		): Effect.fn.Return<void, HostActionError> {
			const snapshot = yield* session.snapshot();
			if (snapshot.inputMode === "host") {
				if (Option.isNone(host))
					return yield* new HostActionFailed("host-keyboard-unavailable");
				return yield* host.value.pressChord(chord);
			}
			return yield* session.pressChord(chord).pipe(
				Effect.matchEffect({
					onSuccess: () => Effect.void,
					onFailure: (cause) => Effect.fail(new HostActionFailed(cause)),
				}),
			);
		}),
	};
}
