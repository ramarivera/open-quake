import { Schema } from "effect";
import {
	type DiagnosticCause,
	toSafeDiagnosticCause,
} from "../device-errors.js";

const entry = <
	const Code extends string,
	const Category extends string,
	const Message extends string,
>(
	code: Code,
	category: Category,
	message: Message,
) =>
	({
		code,
		category,
		message,
		policy: { userFacing: false, userRecoverable: true, retry: "manual" },
	}) as const;

/** Module catalog, composed alongside DeviceErrors without changing siblings. */
export const LightingErrors = {
	TargetUnavailable: entry(
		"QUAKE.LIGHTING.TARGET_UNAVAILABLE",
		"unavailable",
		"The lighting target or binding is unavailable",
	),
	ValueUnsupported: entry(
		"QUAKE.LIGHTING.VALUE_UNSUPPORTED",
		"unavailable",
		"The lighting operation is unsupported",
	),
	InvalidValue: entry(
		"QUAKE.LIGHTING.VALUE_INVALID",
		"validation",
		"The lighting value is invalid",
	),
	ReadFailed: entry(
		"QUAKE.LIGHTING.READ_FAILED",
		"dependency",
		"Reading lighting state failed",
	),
	ApplyFailed: entry(
		"QUAKE.LIGHTING.APPLY_FAILED",
		"dependency",
		"Applying the lighting value failed",
	),
	SaveFailed: entry(
		"QUAKE.LIGHTING.SAVE_FAILED",
		"dependency",
		"Saving lighting state failed",
	),
	IoFailed: entry(
		"QUAKE.LIGHTING.IO_FAILED",
		"dependency",
		"The lighting exchange failed",
	),
} as const;

const SafeCause: Schema.Schema<DiagnosticCause> = Schema.suspend(() =>
	Schema.Struct({
		name: Schema.String,
		sourceCode: Schema.optionalWith(Schema.String, { exact: true }),
		cause: Schema.optionalWith(SafeCause, { exact: true }),
		truncated: Schema.Boolean,
	}),
);
type Entry = (typeof LightingErrors)[keyof typeof LightingErrors];
const fields = <const E extends Entry>(def: E) => ({
	code: Schema.Literal(def.code),
	category: Schema.Literal(def.category),
	message: Schema.Literal(def.message),
	diagnosticCause: SafeCause,
});
const props = <const E extends Entry>(def: E, cause: unknown) => ({
	code: def.code,
	category: def.category,
	message: def.message,
	diagnosticCause: toSafeDiagnosticCause(cause),
});
const retain = (self: object, cause: unknown): void => {
	Object.defineProperty(self, "originalCause", {
		value: cause,
		enumerable: false,
	});
};

export class LightingTargetUnavailable extends Schema.TaggedError<LightingTargetUnavailable>()(
	"LightingTargetUnavailable",
	fields(LightingErrors.TargetUnavailable),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(LightingErrors.TargetUnavailable, cause));
		retain(this, cause);
	}
}
export class LightingValueUnsupported extends Schema.TaggedError<LightingValueUnsupported>()(
	"LightingValueUnsupported",
	fields(LightingErrors.ValueUnsupported),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(LightingErrors.ValueUnsupported, cause));
		retain(this, cause);
	}
}
export class InvalidLightingValue extends Schema.TaggedError<InvalidLightingValue>()(
	"InvalidLightingValue",
	fields(LightingErrors.InvalidValue),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(LightingErrors.InvalidValue, cause));
		retain(this, cause);
	}
}
export class LightingReadFailed extends Schema.TaggedError<LightingReadFailed>()(
	"LightingReadFailed",
	fields(LightingErrors.ReadFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(LightingErrors.ReadFailed, cause));
		retain(this, cause);
	}
}
export class LightingApplyFailed extends Schema.TaggedError<LightingApplyFailed>()(
	"LightingApplyFailed",
	fields(LightingErrors.ApplyFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(LightingErrors.ApplyFailed, cause));
		retain(this, cause);
	}
}
export class LightingSaveFailed extends Schema.TaggedError<LightingSaveFailed>()(
	"LightingSaveFailed",
	fields(LightingErrors.SaveFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(LightingErrors.SaveFailed, cause));
		retain(this, cause);
	}
}
export class LightingIoFailed extends Schema.TaggedError<LightingIoFailed>()(
	"LightingIoFailed",
	fields(LightingErrors.IoFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(LightingErrors.IoFailed, cause));
		retain(this, cause);
	}
}
export type LightingError =
	| LightingTargetUnavailable
	| LightingValueUnsupported
	| InvalidLightingValue
	| LightingReadFailed
	| LightingApplyFailed
	| LightingSaveFailed
	| LightingIoFailed;
