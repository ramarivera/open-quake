import { Schema } from "effect";
import {
	type DiagnosticCause,
	toSafeDiagnosticCause,
} from "../device-errors.js";

const validationPolicy = {
	userFacing: true,
	userRecoverable: true,
	retry: "never",
} as const;
const unavailablePolicy = {
	userFacing: true,
	userRecoverable: true,
	retry: "manual",
} as const;
/** Module-local entries; no shared catalog files are modified by this lane. */
export const KnobErrors = {
	InvalidKnobConfig: {
		code: "QUAKE.KNOB.CONFIG_INVALID",
		category: "validation",
		message: "The knob configuration or event is invalid",
		policy: validationPolicy,
	},
	KnobCapabilityUnavailable: {
		code: "QUAKE.KNOB.CAPABILITY_UNAVAILABLE",
		category: "unavailable",
		message: "The selected knob capability is unavailable",
		policy: unavailablePolicy,
	},
	KnobRouteIncomplete: {
		code: "QUAKE.KNOB.ROUTE_INCOMPLETE",
		category: "validation",
		message: "The knob voice route is incomplete",
		policy: validationPolicy,
	},
	KnobDispatchFailed: {
		code: "QUAKE.KNOB.DISPATCH_FAILED",
		category: "dependency",
		message: "Dispatching the knob operation failed",
		policy: { ...unavailablePolicy, userFacing: false, retry: "never" },
	},
	KnobSessionStale: {
		code: "QUAKE.KNOB.SESSION_STALE",
		category: "validation",
		message: "The knob event belongs to an inactive session",
		policy: { userFacing: false, userRecoverable: false, retry: "never" },
	},
} as const;
const diagnostic: Schema.Schema<DiagnosticCause> = Schema.suspend(() =>
	Schema.Struct({
		name: Schema.String,
		sourceCode: Schema.optionalWith(Schema.String, { exact: true }),
		cause: Schema.optionalWith(diagnostic, { exact: true }),
		truncated: Schema.Boolean,
	}),
);
type Entry = (typeof KnobErrors)[keyof typeof KnobErrors];
const fields = <const E extends Entry>(e: E) => ({
	code: Schema.Literal(e.code),
	category: Schema.Literal(e.category),
	message: Schema.Literal(e.message),
	diagnosticCause: diagnostic,
});
const props = <const E extends Entry>(e: E, cause: unknown) => ({
	code: e.code,
	category: e.category,
	message: e.message,
	diagnosticCause: toSafeDiagnosticCause(cause),
});
const retain = <T extends object>(error: T, cause: unknown): T => {
	Object.defineProperty(error, "originalCause", {
		value: cause,
		enumerable: false,
	});
	return error;
};
export class InvalidKnobConfig extends Schema.TaggedError<InvalidKnobConfig>()(
	"InvalidKnobConfig",
	fields(KnobErrors.InvalidKnobConfig),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown = undefined): InvalidKnobConfig {
		return retain(
			new InvalidKnobConfig(props(KnobErrors.InvalidKnobConfig, cause)),
			cause,
		);
	}
}
export class KnobCapabilityUnavailable extends Schema.TaggedError<KnobCapabilityUnavailable>()(
	"KnobCapabilityUnavailable",
	fields(KnobErrors.KnobCapabilityUnavailable),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown = undefined): KnobCapabilityUnavailable {
		return retain(
			new KnobCapabilityUnavailable(
				props(KnobErrors.KnobCapabilityUnavailable, cause),
			),
			cause,
		);
	}
}
export class KnobRouteIncomplete extends Schema.TaggedError<KnobRouteIncomplete>()(
	"KnobRouteIncomplete",
	fields(KnobErrors.KnobRouteIncomplete),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown = undefined): KnobRouteIncomplete {
		return retain(
			new KnobRouteIncomplete(props(KnobErrors.KnobRouteIncomplete, cause)),
			cause,
		);
	}
}
export class KnobDispatchFailed extends Schema.TaggedError<KnobDispatchFailed>()(
	"KnobDispatchFailed",
	fields(KnobErrors.KnobDispatchFailed),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown = undefined): KnobDispatchFailed {
		return retain(
			new KnobDispatchFailed(props(KnobErrors.KnobDispatchFailed, cause)),
			cause,
		);
	}
}
export class KnobSessionStale extends Schema.TaggedError<KnobSessionStale>()(
	"KnobSessionStale",
	fields(KnobErrors.KnobSessionStale),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown = undefined): KnobSessionStale {
		return retain(
			new KnobSessionStale(props(KnobErrors.KnobSessionStale, cause)),
			cause,
		);
	}
}
export type KnobError =
	| InvalidKnobConfig
	| KnobCapabilityUnavailable
	| KnobRouteIncomplete
	| KnobDispatchFailed
	| KnobSessionStale;
