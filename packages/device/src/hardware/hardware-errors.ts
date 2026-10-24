import { Schema } from "effect";
import {
	DiagnosticCause,
	QuakeConnectionClosed,
	QuakeHidWriteFailed,
	toSafeDiagnosticCause,
} from "../device-errors.js";

const entry = <const C extends string, const M extends string>(
	code: C,
	message: M,
) =>
	({
		code,
		category: "dependency",
		message,
		policy: { userFacing: false, userRecoverable: true, retry: "never" },
	}) as const;
export const HardwareErrors = {
	HardwareUnavailable: entry(
		"QUAKE.HARDWARE.UNAVAILABLE",
		"Device controls are unavailable",
	),
	HardwareReplyTimeout: entry(
		"QUAKE.HARDWARE.REPLY_TIMEOUT",
		"Device reply timed out; reconnect required",
	),
	HardwareCommandRejected: entry(
		"QUAKE.HARDWARE.COMMAND_REJECTED",
		"Device rejected the command",
	),
	HardwarePreferencesFailed: entry(
		"QUAKE.HARDWARE.PREFERENCES_FAILED",
		"Device preferences could not be stored",
	),
} as const;
const fields = <const C extends string, const M extends string>(e: {
	code: C;
	message: M;
}) => ({
	code: Schema.Literal(e.code),
	category: Schema.Literal("dependency"),
	message: Schema.Literal(e.message),
	diagnosticCause: DiagnosticCause,
});
const retain = (self: object, cause: unknown) =>
	Object.defineProperty(self, "originalCause", {
		value: cause,
		enumerable: false,
	});
const safeCause = (cause: unknown): DiagnosticCause =>
	cause instanceof QuakeHidWriteFailed || cause instanceof QuakeConnectionClosed
		? {
				name: cause._tag,
				sourceCode: cause.code,
				cause: cause.diagnosticCause,
				truncated: true,
			}
		: toSafeDiagnosticCause(cause);
const props = <
	const E extends { code: string; message: string; category: "dependency" },
>(
	e: E,
	cause: unknown,
): {
	code: E["code"];
	message: E["message"];
	category: E["category"];
	diagnosticCause: DiagnosticCause;
} => ({
	code: e.code,
	message: e.message,
	category: e.category,
	diagnosticCause: safeCause(cause),
});
export class HardwareUnavailable extends Schema.TaggedError<HardwareUnavailable>()(
	"HardwareUnavailable",
	fields(HardwareErrors.HardwareUnavailable),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(HardwareErrors.HardwareUnavailable, cause));
		retain(this, cause);
	}
}
export class HardwareReplyTimeout extends Schema.TaggedError<HardwareReplyTimeout>()(
	"HardwareReplyTimeout",
	fields(HardwareErrors.HardwareReplyTimeout),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(HardwareErrors.HardwareReplyTimeout, cause));
		retain(this, cause);
	}
}
export class HardwareCommandRejected extends Schema.TaggedError<HardwareCommandRejected>()(
	"HardwareCommandRejected",
	fields(HardwareErrors.HardwareCommandRejected),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(HardwareErrors.HardwareCommandRejected, cause));
		retain(this, cause);
	}
}
export class HardwarePreferencesFailed extends Schema.TaggedError<HardwarePreferencesFailed>()(
	"HardwarePreferencesFailed",
	fields(HardwareErrors.HardwarePreferencesFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(HardwareErrors.HardwarePreferencesFailed, cause));
		retain(this, cause);
	}
}
export type HardwareError =
	| HardwareUnavailable
	| HardwareReplyTimeout
	| HardwareCommandRejected
	| HardwarePreferencesFailed;
