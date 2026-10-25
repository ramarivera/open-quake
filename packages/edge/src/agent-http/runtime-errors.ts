import { Schema } from "effect";
import { DiagnosticCause, toSafeDiagnosticCause } from "../ai/ai-errors.js";

const entry = <
	const C extends string,
	const K extends string,
	const M extends string,
>(
	code: C,
	category: K,
	message: M,
) => ({
	code,
	category,
	message,
	policy: { userFacing: true, userRecoverable: true, retry: "manual" as const },
});
export const RuntimeErrors = {
	RuntimeConnectionInvalid: entry(
		"AGENT.HTTP.CONNECTION.INVALID",
		"validation",
		"The runtime connection is invalid",
	),
	RuntimeAuthenticationFailed: entry(
		"AGENT.HTTP.AUTH.FAILED",
		"authentication",
		"Runtime authentication failed",
	),
	RuntimeUnavailable: entry(
		"AGENT.HTTP.CONNECTION.UNAVAILABLE",
		"unavailable",
		"The runtime is unavailable",
	),
	RuntimeProtocolInvalid: entry(
		"AGENT.HTTP.PROTOCOL.INVALID",
		"dependency",
		"The runtime response is invalid",
	),
	RuntimeCapabilityUnsupported: entry(
		"AGENT.HTTP.CAPABILITY.UNSUPPORTED",
		"validation",
		"The runtime operation is unsupported",
	),
	RuntimeRequestFailed: entry(
		"AGENT.HTTP.REQUEST.FAILED",
		"dependency",
		"The runtime request failed",
	),
	RuntimeTimeout: entry(
		"AGENT.HTTP.REQUEST.TIMEOUT",
		"dependency",
		"The runtime request timed out",
	),
	RuntimeLimitExceeded: entry(
		"AGENT.HTTP.RESPONSE.LIMIT_EXCEEDED",
		"validation",
		"The runtime response exceeded its limit",
	),
	RuntimeCredentialUnavailable: entry(
		"AGENT.HTTP.CREDENTIAL.UNAVAILABLE",
		"unavailable",
		"The runtime credential is unavailable",
	),
	RuntimeStorageFailed: entry(
		"AGENT.HTTP.STORAGE.FAILED",
		"dependency",
		"Runtime connection storage failed",
	),
} as const;
type Entry = (typeof RuntimeErrors)[keyof typeof RuntimeErrors];
const fields = <const E extends Entry>(definition: E) => ({
	code: Schema.Literal(definition.code),
	category: Schema.Literal(definition.category),
	message: Schema.Literal(definition.message),
	diagnosticCause: DiagnosticCause,
});
const props = <const E extends Entry>(definition: E, cause: unknown) => ({
	code: definition.code,
	category: definition.category,
	message: definition.message,
	diagnosticCause: toSafeDiagnosticCause(cause),
});
const retain = (target: object, cause: unknown): void => {
	Object.defineProperty(target, "originalCause", {
		value: cause,
		enumerable: false,
	});
};
export class RuntimeConnectionInvalid extends Schema.TaggedError<RuntimeConnectionInvalid>()(
	"RuntimeConnectionInvalid",
	fields(RuntimeErrors.RuntimeConnectionInvalid),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(RuntimeErrors.RuntimeConnectionInvalid, cause));
		retain(this, cause);
	}
}
export class RuntimeAuthenticationFailed extends Schema.TaggedError<RuntimeAuthenticationFailed>()(
	"RuntimeAuthenticationFailed",
	fields(RuntimeErrors.RuntimeAuthenticationFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(RuntimeErrors.RuntimeAuthenticationFailed, cause));
		retain(this, cause);
	}
}
export class RuntimeUnavailable extends Schema.TaggedError<RuntimeUnavailable>()(
	"RuntimeUnavailable",
	fields(RuntimeErrors.RuntimeUnavailable),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(RuntimeErrors.RuntimeUnavailable, cause));
		retain(this, cause);
	}
}
export class RuntimeProtocolInvalid extends Schema.TaggedError<RuntimeProtocolInvalid>()(
	"RuntimeProtocolInvalid",
	fields(RuntimeErrors.RuntimeProtocolInvalid),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(RuntimeErrors.RuntimeProtocolInvalid, cause));
		retain(this, cause);
	}
}
export class RuntimeCapabilityUnsupported extends Schema.TaggedError<RuntimeCapabilityUnsupported>()(
	"RuntimeCapabilityUnsupported",
	fields(RuntimeErrors.RuntimeCapabilityUnsupported),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(RuntimeErrors.RuntimeCapabilityUnsupported, cause));
		retain(this, cause);
	}
}
export class RuntimeRequestFailed extends Schema.TaggedError<RuntimeRequestFailed>()(
	"RuntimeRequestFailed",
	fields(RuntimeErrors.RuntimeRequestFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(RuntimeErrors.RuntimeRequestFailed, cause));
		retain(this, cause);
	}
}
export class RuntimeTimeout extends Schema.TaggedError<RuntimeTimeout>()(
	"RuntimeTimeout",
	fields(RuntimeErrors.RuntimeTimeout),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(RuntimeErrors.RuntimeTimeout, cause));
		retain(this, cause);
	}
}
export class RuntimeLimitExceeded extends Schema.TaggedError<RuntimeLimitExceeded>()(
	"RuntimeLimitExceeded",
	fields(RuntimeErrors.RuntimeLimitExceeded),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(RuntimeErrors.RuntimeLimitExceeded, cause));
		retain(this, cause);
	}
}
export class RuntimeCredentialUnavailable extends Schema.TaggedError<RuntimeCredentialUnavailable>()(
	"RuntimeCredentialUnavailable",
	fields(RuntimeErrors.RuntimeCredentialUnavailable),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(RuntimeErrors.RuntimeCredentialUnavailable, cause));
		retain(this, cause);
	}
}
export class RuntimeStorageFailed extends Schema.TaggedError<RuntimeStorageFailed>()(
	"RuntimeStorageFailed",
	fields(RuntimeErrors.RuntimeStorageFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(RuntimeErrors.RuntimeStorageFailed, cause));
		retain(this, cause);
	}
}
export type RuntimeError =
	| RuntimeConnectionInvalid
	| RuntimeAuthenticationFailed
	| RuntimeUnavailable
	| RuntimeProtocolInvalid
	| RuntimeCapabilityUnsupported
	| RuntimeRequestFailed
	| RuntimeTimeout
	| RuntimeLimitExceeded
	| RuntimeCredentialUnavailable
	| RuntimeStorageFailed;
