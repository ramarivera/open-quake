import { Effect, Schema } from "effect";
import {
	KnobCapabilityUnavailable,
	KnobDispatchFailed,
	type KnobError,
} from "../../../../../../packages/device/src/knob/knob-errors.js";
import type { BrightnessReading } from "./controller";

const response = Schema.Union(
	Schema.Struct({ supported: Schema.Literal(false) }),
	Schema.Struct({
		supported: Schema.Literal(true),
		target: Schema.NonEmptyString,
		percent: Schema.Number.pipe(Schema.between(0, 100)),
		quantum: Schema.Number.pipe(
			Schema.positive(),
			Schema.lessThanOrEqualTo(100),
		),
	}),
);
export const decodeBrightness = (
	output: string,
): Effect.Effect<BrightnessReading, KnobError> =>
	Effect.try({
		try: () => Schema.decodeUnknownSync(Schema.parseJson(response))(output),
		catch: KnobDispatchFailed.fromCause,
	}).pipe(
		Effect.flatMap(
			(value): Effect.Effect<BrightnessReading, KnobError> =>
				value.supported
					? Effect.succeed(value)
					: Effect.fail(KnobCapabilityUnavailable.fromCause()),
		),
	);
