import { Schema } from "effect";
import { DiagnosticCause, toSafeDiagnosticCause } from "../ai/ai-errors.js";

const policy = {
	userFacing: true,
	userRecoverable: true,
	retry: "manual" as const,
};
export const SettingsErrors = {
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
	constructor(cause?: unknown) {
		super(properties("Invalid", cause));
		retain(this, cause);
	}
}
export class SettingsReadFailed extends Schema.TaggedError<SettingsReadFailed>()(
	"SettingsReadFailed",
	fields("ReadFailed"),
) {
	declare readonly originalCause: unknown;
	constructor(cause?: unknown) {
		super(properties("ReadFailed", cause));
		retain(this, cause);
	}
}
export class SettingsPersistFailed extends Schema.TaggedError<SettingsPersistFailed>()(
	"SettingsPersistFailed",
	fields("PersistFailed"),
) {
	declare readonly originalCause: unknown;
	constructor(cause?: unknown) {
		super(properties("PersistFailed", cause));
		retain(this, cause);
	}
}
export const SettingsFailure = Schema.Union(
	SettingsInvalid,
	SettingsReadFailed,
	SettingsPersistFailed,
);
export type SettingsFailure = typeof SettingsFailure.Type;
