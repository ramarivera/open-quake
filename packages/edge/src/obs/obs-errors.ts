import { Schema } from "effect";
import { toSafeDiagnosticCause } from "../ai/ai-errors.js";

const entry = <const C extends string, const M extends string>(
	code: C,
	message: M,
	retry: "manual" | "automatic",
) => ({
	code,
	message,
	category: "dependency",
	policy: { userFacing: true, userRecoverable: true, retry },
});
export const ObsErrors = {
	ObsNetworkFailed: entry(
		"OBS.NETWORK.FAILED",
		"OBS connection failed",
		"automatic",
	),
	ObsAuthenticationFailed: entry(
		"OBS.AUTH.FAILED",
		"OBS authentication failed",
		"manual",
	),
	ObsRpcUnsupported: entry(
		"OBS.RPC.UNSUPPORTED",
		"OBS WebSocket v5 is required",
		"manual",
	),
	ObsRequestFailed: entry("OBS.REQUEST.FAILED", "OBS request failed", "manual"),
	ObsConfigurationRejected: entry(
		"OBS.CONFIG.REJECTED",
		"Invalid OBS configuration",
		"manual",
	),
	ObsStorageFailed: entry(
		"OBS.STORAGE.FAILED",
		"OBS secure settings could not be read or saved",
		"manual",
	),
} as const;
const fields = <const E extends (typeof ObsErrors)[keyof typeof ObsErrors]>(
	e: E,
) => ({
	code: Schema.Literal(e.code),
	category: Schema.Literal(e.category),
	message: Schema.Literal(e.message),
	diagnosticCause: Schema.Unknown,
});
const props = <const E extends (typeof ObsErrors)[keyof typeof ObsErrors]>(
	e: E,
	cause: unknown,
) => ({
	code: e.code,
	category: e.category,
	message: e.message,
	diagnosticCause: toSafeDiagnosticCause(cause),
});
const retain = (target: object, cause: unknown) =>
	Object.defineProperty(target, "originalCause", {
		value: cause,
		enumerable: false,
	});
export class ObsNetworkFailed extends Schema.TaggedError<ObsNetworkFailed>()(
	"ObsNetworkFailed",
	fields(ObsErrors.ObsNetworkFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(ObsErrors.ObsNetworkFailed, cause));
		retain(this, cause);
	}
}
export class ObsAuthenticationFailed extends Schema.TaggedError<ObsAuthenticationFailed>()(
	"ObsAuthenticationFailed",
	fields(ObsErrors.ObsAuthenticationFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(ObsErrors.ObsAuthenticationFailed, cause));
		retain(this, cause);
	}
}
export class ObsRpcUnsupported extends Schema.TaggedError<ObsRpcUnsupported>()(
	"ObsRpcUnsupported",
	fields(ObsErrors.ObsRpcUnsupported),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(ObsErrors.ObsRpcUnsupported, cause));
		retain(this, cause);
	}
}
export class ObsRequestFailed extends Schema.TaggedError<ObsRequestFailed>()(
	"ObsRequestFailed",
	fields(ObsErrors.ObsRequestFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(ObsErrors.ObsRequestFailed, cause));
		retain(this, cause);
	}
}
export class ObsConfigurationRejected extends Schema.TaggedError<ObsConfigurationRejected>()(
	"ObsConfigurationRejected",
	fields(ObsErrors.ObsConfigurationRejected),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(ObsErrors.ObsConfigurationRejected, cause));
		retain(this, cause);
	}
}
export class ObsStorageFailed extends Schema.TaggedError<ObsStorageFailed>()(
	"ObsStorageFailed",
	fields(ObsErrors.ObsStorageFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(ObsErrors.ObsStorageFailed, cause));
		retain(this, cause);
	}
}
export type ObsError =
	| ObsNetworkFailed
	| ObsAuthenticationFailed
	| ObsRpcUnsupported
	| ObsRequestFailed
	| ObsConfigurationRejected
	| ObsStorageFailed;
export const obsBoundaryError = (cause: unknown): ObsError =>
	cause instanceof ObsNetworkFailed ||
	cause instanceof ObsAuthenticationFailed ||
	cause instanceof ObsRpcUnsupported ||
	cause instanceof ObsRequestFailed ||
	cause instanceof ObsConfigurationRejected ||
	cause instanceof ObsStorageFailed
		? cause
		: new ObsNetworkFailed(cause);
