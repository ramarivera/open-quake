import { Effect, Schema } from "effect";
import { HardwareUnavailable } from "./hardware-errors.js";
import type { HardwareSession } from "./hardware-service.js";

const toggles = Schema.Tuple(
	Schema.Struct({ type: Schema.Literal("toggle"), value: Schema.Literal(0) }),
	Schema.Struct({ type: Schema.Literal("toggle"), value: Schema.Literal(1) }),
);
export const BuzzerKeyConfig = Schema.Struct({
	type: Schema.Literal("buzzer"),
	actions: toggles,
});
export const MicKeyConfig = Schema.Struct({
	type: Schema.Literal("mic"),
	actions: toggles,
});
export const LuminanceKeyConfig = Schema.Struct({
	type: Schema.Literal("luminance"),
	actions: Schema.Tuple(
		Schema.Struct({ type: Schema.Literal("level"), value: Schema.Literal(1) }),
		Schema.Struct({ type: Schema.Literal("level"), value: Schema.Literal(0) }),
	),
});
export const GameModeKeyConfig = Schema.Struct({
	type: Schema.Literal("gameMode"),
	actions: Schema.Array(
		Schema.Union(
			Schema.Struct({
				type: Schema.Literal("path"),
				value: Schema.String.pipe(Schema.maxLength(8192)),
			}),
			Schema.Struct({
				type: Schema.Literal("monitorAppView"),
				value: Schema.Boolean,
			}),
		),
	).pipe(
		Schema.filter(
			(actions) => new Set(actions.map((a) => a.type)).size === actions.length,
		),
	),
});
export const HardwareKeyConfig = Schema.Union(
	BuzzerKeyConfig,
	MicKeyConfig,
	LuminanceKeyConfig,
	GameModeKeyConfig,
);
export type HardwareKeyConfig = typeof HardwareKeyConfig.Type;
export const isHardwareKey = (type: string) =>
	["buzzer", "mic", "luminance", "gameMode"].includes(type);

/** The activation's serial, never the currently selected UI device, owns the effect. */
export const executeHardwareKey = Effect.fn("HardwareControls.executeKey")(
	function* (
		config: HardwareKeyConfig,
		session: HardwareSession | undefined,
		serial?: string,
	) {
		if (!session) return yield* new HardwareUnavailable();
		const state = yield* session.snapshot();
		if (!state.available || (serial && state.serial !== serial))
			return yield* new HardwareUnavailable();
		switch (config.type) {
			case "buzzer":
				return yield* session.configure({
					...state.preferences,
					buzzerEnabled: !state.preferences.buzzerEnabled,
				});
			case "mic":
				return yield* session.toggleMic();
			case "luminance":
				return yield* session.stepBrightness(-1);
			case "gameMode":
				return yield* session.setInputMode(
					state.inputMode === "device" ? "host" : "device",
				);
		}
	},
);
