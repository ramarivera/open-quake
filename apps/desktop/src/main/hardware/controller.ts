import type { HardwareSession } from "@open-quake/device";
import { Effect, Either, Schema } from "effect";
import {
	HardwareRequest,
	type HardwareResponse,
} from "../../shared/hardware-contracts";
import { hostKeyboardAvailable } from "./host-keyboard";

/** Captures one session before awaiting; a stale renderer cannot target its replacement. */
export function hardwareRequest(
	input: unknown,
	current: HardwareSession | undefined,
	mock: boolean,
): Effect.Effect<HardwareResponse> {
	return Effect.gen(function* () {
		const decoded = Schema.decodeUnknownEither(HardwareRequest)(input);
		if (Either.isLeft(decoded))
			return {
				_tag: "failure",
				code: "QUAKE.HARDWARE.INVALID_REQUEST",
			} as const;
		if (!current) return { _tag: "offline" } as const;
		const command = decoded.right;
		const snapshot = yield* current.snapshot();
		if (command._tag === "chooseGameTarget" || command._tag === "qmkTargets" || command._tag === "qmk" || command._tag === "lighting") return {_tag: "failure", code: "QUAKE.HARDWARE.INVALID_REQUEST"} as const;
        if (command._tag !== "read" && command.session !== snapshot.session)
			return { _tag: "failure", code: "QUAKE.HARDWARE.STALE_SESSION" } as const;
		switch (command._tag) {
			case "read":
				break;
			case "configure":
				yield* current.configure(command.preferences);
				break;
			case "inputMode":
				if (command.mode === "host" && !mock && !hostKeyboardAvailable())
					return {
						_tag: "failure",
						code: "QUAKE.HARDWARE.HOST_KEYBOARD_UNAVAILABLE",
					} as const;
				yield* current.setInputMode(command.mode);
				break;
			case "refresh":
				yield* current.refresh();
				break;
			case "longTone":
				yield* current.setLongTone(command.on);
				break;
			case "toggleMic":
				yield* current.toggleMic();
				break;
			case "stepBrightness":
				yield* current.stepBrightness(command.direction);
				break;
		}
		return {
			_tag: "ready",
			snapshot: yield* current.snapshot(),
			mock,
		} as const;
	}).pipe(
		Effect.catchTags({
			HardwareUnavailable: (error) =>
				Effect.succeed({ _tag: "failure" as const, code: error.code }),
			HardwareReplyTimeout: (error) =>
				Effect.succeed({ _tag: "failure" as const, code: error.code }),
			HardwareCommandRejected: (error) =>
				Effect.succeed({ _tag: "failure" as const, code: error.code }),
			HardwarePreferencesFailed: (error) =>
				Effect.succeed({ _tag: "failure" as const, code: error.code }),
		}),
	);
}
