import { Schema } from "effect";
import {
	type DiagnosticCause,
	toSafeDiagnosticCause,
} from "../device-errors.js";

const manual = {
	userFacing: true,
	userRecoverable: true,
	retry: "manual",
} as const;
export const ActionErrors = {
	InvalidKeyAction: {
		code: "QUAKE.ACTION.INVALID",
		category: "validation",
		message: "The key action is invalid",
		policy: manual,
	},
	KeyFunctionUnavailable: {
		code: "QUAKE.ACTION.UNAVAILABLE",
		category: "unavailable",
		message: "The key function capability is unavailable",
		policy: manual,
	},
	ActionPermissionDenied: {
		code: "QUAKE.ACTION.PERMISSION_DENIED",
		category: "permission",
		message: "Host action permission was denied",
		policy: manual,
	},
	ActionApplicationMissing: {
		code: "QUAKE.ACTION.APPLICATION_MISSING",
		category: "unavailable",
		message: "The selected application is unavailable",
		policy: manual,
	},
	HostActionFailed: {
		code: "QUAKE.ACTION.HOST_FAILED",
		category: "dependency",
		message: "The host action failed",
		policy: manual,
	},
	ActionSnapshotFailed: {
		code: "QUAKE.ACTION.SNAPSHOT_FAILED",
		category: "dependency",
		message: "Reading the committed action snapshot failed",
		policy: manual,
	},
} as const;
const SafeCause: Schema.Schema<DiagnosticCause> = Schema.suspend(() =>
	Schema.Struct({
		name: Schema.String,
		sourceCode: Schema.optionalWith(Schema.String, { exact: true }),
		cause: Schema.optionalWith(SafeCause, { exact: true }),
		truncated: Schema.Boolean,
	}),
);
type Entry = (typeof ActionErrors)[keyof typeof ActionErrors];
const fields = <const E extends Entry>(entry: E) => ({
	code: Schema.Literal<[E["code"]]>(entry.code),
	category: Schema.Literal<[E["category"]]>(entry.category),
	message: Schema.Literal<[E["message"]]>(entry.message),
	recoverable: Schema.Literal(entry.policy.userRecoverable),
	diagnosticCause: SafeCause,
});
const props = <const E extends Entry>(
	entry: E,
	cause: unknown,
): {
	code: E["code"];
	category: E["category"];
	message: E["message"];
	recoverable: true;
	diagnosticCause: DiagnosticCause;
} => ({
	code: entry.code,
	category: entry.category,
	message: entry.message,
	recoverable: entry.policy.userRecoverable,
	diagnosticCause: toSafeDiagnosticCause(cause),
});
const retain = (error: object, cause: unknown): void => {
	Object.defineProperty(error, "originalCause", {
		value: cause,
		enumerable: false,
	});
};
export const ActionField = Schema.Literal(
	"config",
	"config.type",
	"config.actions",
	"config.supportKnob",
	"activation",
);
export class InvalidKeyAction extends Schema.TaggedError<InvalidKeyAction>()(
	"InvalidKeyAction",
	{
		...fields(ActionErrors.InvalidKeyAction),
		field: ActionField,
	},
) {
	declare readonly originalCause: unknown;
	constructor(field: typeof ActionField.Type, cause: unknown = undefined) {
		super({ ...props(ActionErrors.InvalidKeyAction, cause), field });
		retain(this, cause);
	}
}
export class KeyFunctionUnavailable extends Schema.TaggedError<KeyFunctionUnavailable>()(
	"KeyFunctionUnavailable",
	{
		...fields(ActionErrors.KeyFunctionUnavailable),
		reason: Schema.Literal(
			"unknown-function",
			"unresolved",
			"owning-runtime",
			"adapter-missing",
			"unsupported-token",
			"unsupported-command",
			"knob-routing",
		),
	},
) {
	declare readonly originalCause: unknown;
	constructor(reason: KeyFunctionUnavailable["reason"]) {
		super({ ...props(ActionErrors.KeyFunctionUnavailable, undefined), reason });
		retain(this, undefined);
	}
}
export class ActionPermissionDenied extends Schema.TaggedError<ActionPermissionDenied>()(
	"ActionPermissionDenied",
	fields(ActionErrors.ActionPermissionDenied),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(ActionErrors.ActionPermissionDenied, cause));
		retain(this, cause);
	}
}
export class ActionApplicationMissing extends Schema.TaggedError<ActionApplicationMissing>()(
	"ActionApplicationMissing",
	fields(ActionErrors.ActionApplicationMissing),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(ActionErrors.ActionApplicationMissing, cause));
		retain(this, cause);
	}
}
export class HostActionFailed extends Schema.TaggedError<HostActionFailed>()(
	"HostActionFailed",
	fields(ActionErrors.HostActionFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(ActionErrors.HostActionFailed, cause));
		retain(this, cause);
	}
}
export class ActionSnapshotFailed extends Schema.TaggedError<ActionSnapshotFailed>()(
	"ActionSnapshotFailed",
	fields(ActionErrors.ActionSnapshotFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(ActionErrors.ActionSnapshotFailed, cause));
		retain(this, cause);
	}
}
export type HostActionError =
	| ActionPermissionDenied
	| ActionApplicationMissing
	| HostActionFailed;
export type ActionError =
	| InvalidKeyAction
	| KeyFunctionUnavailable
	| HostActionError
	| ActionSnapshotFailed;
