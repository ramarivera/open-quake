import { Schema } from "effect";
import { DiagnosticCause, toSafeDiagnosticCause } from "../ai/ai-errors.js";

const policy = {
	userFacing: true,
	userRecoverable: true,
	retry: "manual" as const,
};
export const SettingsErrors = {
	OsApplyFailed: {
		code: "QUAKE.SETTINGS.OS_APPLY_FAILED",
		category: "dependency",
		message: "The operating system preference could not be applied",
		policy,
	},
	WizardIncomplete: {
		code: "QUAKE.WIZARD.INCOMPLETE",
		category: "validation",
		message: "The local setup prerequisites are incomplete",
		policy,
	},
	Invalid: {
		code: "QUAKE.SETTINGS.INVALID",
		category: "validation",
		message: "The settings are invalid",
		policy,
	},
	ReadFailed: {
		code: "QUAKE.SETTINGS.READ_FAILED",
		category: "dependency",
		message: "The settings could not be read",
		policy,
	},
	PersistFailed: {
		code: "QUAKE.SETTINGS.PERSIST_FAILED",
		category: "dependency",
		message: "The settings could not be saved",
		policy,
	},
} as const;
const fields = <const K extends keyof typeof SettingsErrors>(key: K) => ({
	code: Schema.Literal(SettingsErrors[key].code),
	category: Schema.Literal(SettingsErrors[key].category),
	message: Schema.Literal(SettingsErrors[key].message),
	diagnosticCause: DiagnosticCause,
});
const properties = <const K extends keyof typeof SettingsErrors>(
	key: K,
	cause: unknown,
) => ({
	...SettingsErrors[key],
	diagnosticCause: toSafeDiagnosticCause(cause),
});
const retain = (target: object, cause: unknown) =>
	Object.defineProperty(target, "originalCause", {
		value: cause,
		enumerable: false,
	});
export class SettingsInvalid extends Schema.TaggedError<SettingsInvalid>()(
	"SettingsInvalid",
	fields("Invalid"),
) {
	declare readonly originalCause: unknown;
	constructor(cause?: unknown, decoded = false) {
		super(
			decoded
				? Schema.decodeUnknownSync(Schema.Struct(fields("Invalid")))(cause)
				: properties("Invalid", cause),
		);
		retain(this, decoded ? undefined : cause);
	}
}
export class SettingsReadFailed extends Schema.TaggedError<SettingsReadFailed>()(
	"SettingsReadFailed",
	fields("ReadFailed"),
) {
	declare readonly originalCause: unknown;
	constructor(cause?: unknown, decoded = false) {
		super(
			decoded
				? Schema.decodeUnknownSync(Schema.Struct(fields("ReadFailed")))(cause)
				: properties("ReadFailed", cause),
		);
		retain(this, decoded ? undefined : cause);
	}
}
export class SettingsPersistFailed extends Schema.TaggedError<SettingsPersistFailed>()(
	"SettingsPersistFailed",
	fields("PersistFailed"),
) {
	declare readonly originalCause: unknown;
	constructor(cause?: unknown, decoded = false) {
		super(
			decoded
				? Schema.decodeUnknownSync(Schema.Struct(fields("PersistFailed")))(
						cause,
					)
				: properties("PersistFailed", cause),
		);
		retain(this, decoded ? undefined : cause);
	}
}
const OsReason = Schema.Literal(
	"unsupported",
	"denied",
	"timeout",
	"unverified",
	"unavailable",
);
const OsFields = { ...fields("OsApplyFailed"), reason: OsReason };
export class SettingsOsApplyFailed extends Schema.TaggedError<SettingsOsApplyFailed>()(
	"SettingsOsApplyFailed",
	OsFields,
) {
	declare readonly originalCause: unknown;
	constructor(
		cause?: unknown,
		reason: typeof OsReason.Type | true = "unavailable",
	) {
		// Effect's class schema decodes via new this(validatedFields, true).
		// Keep the safe wire projection, never reinterpret fields as a raw cause.
		super(
			reason === true
				? Schema.decodeUnknownSync(Schema.Struct(OsFields))(cause)
				: { ...properties("OsApplyFailed", cause), reason },
		);
		retain(this, reason === true ? undefined : cause);
	}
}
export class WizardIncomplete extends Schema.TaggedError<WizardIncomplete>()(
	"WizardIncomplete",
	fields("WizardIncomplete"),
) {
	declare readonly originalCause: unknown;
	constructor(cause?: unknown, decoded = false) {
		super(
			decoded
				? Schema.decodeUnknownSync(Schema.Struct(fields("WizardIncomplete")))(
						cause,
					)
				: properties("WizardIncomplete", cause),
		);
		retain(this, decoded ? undefined : cause);
	}
}
export const SettingsBackendFailure = Schema.Union(
	SettingsInvalid,
	SettingsReadFailed,
	SettingsPersistFailed,
	SettingsOsApplyFailed,
	WizardIncomplete,
);
export type SettingsBackendFailure = typeof SettingsBackendFailure.Type;
export const SettingsFailure = Schema.Union(
	SettingsInvalid,
	SettingsReadFailed,
	SettingsPersistFailed,
);
export type SettingsFailure = typeof SettingsFailure.Type;
