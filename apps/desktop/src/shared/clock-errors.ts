import { Schema } from "effect";
import {
	type DiagnosticCause,
	toSafeDiagnosticCause,
} from "../../../../packages/device/src/device-errors";

const validation = {
	userFacing: true,
	userRecoverable: true,
	retry: "never",
} as const;
const dependency = {
	userFacing: true,
	userRecoverable: true,
	retry: "manual",
} as const;

/** Module-local catalog entries for the desktop clock (desktop-clock design §12). */
export const ClockErrors = {
	ClockConfigInvalid: {
		code: "QUAKE.CLOCK.CONFIG_INVALID",
		category: "validation",
		message: "Clock settings are invalid",
		policy: validation,
	},
	ClockPersistenceFailed: {
		code: "QUAKE.CLOCK.PERSISTENCE_FAILED",
		category: "dependency",
		message:
			"Clock settings could not be saved; the previous settings were kept",
		policy: dependency,
	},
	// DK-Suite's own strings (settings.clockBgPathInvalid, minWallpaperDuration).
	ClockMediaUnusable: {
		code: "QUAKE.CLOCK.MEDIA_UNUSABLE",
		category: "validation",
		message: "File missing or unusable; fell back to built-in",
		policy: validation,
	},
	ClockMediaTooShort: {
		code: "QUAKE.CLOCK.MEDIA_TOO_SHORT",
		category: "validation",
		message: "Video duration too short, should be longer than 2 seconds.",
		policy: validation,
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
type Entry = (typeof ClockErrors)[keyof typeof ClockErrors];
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

export class ClockConfigInvalid extends Schema.TaggedError<ClockConfigInvalid>()(
	"ClockConfigInvalid",
	fields(ClockErrors.ClockConfigInvalid),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown = undefined): ClockConfigInvalid {
		return retain(
			new ClockConfigInvalid(props(ClockErrors.ClockConfigInvalid, cause)),
			cause,
		);
	}
}
export class ClockPersistenceFailed extends Schema.TaggedError<ClockPersistenceFailed>()(
	"ClockPersistenceFailed",
	fields(ClockErrors.ClockPersistenceFailed),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown = undefined): ClockPersistenceFailed {
		return retain(
			new ClockPersistenceFailed(
				props(ClockErrors.ClockPersistenceFailed, cause),
			),
			cause,
		);
	}
}
export class ClockMediaUnusable extends Schema.TaggedError<ClockMediaUnusable>()(
	"ClockMediaUnusable",
	fields(ClockErrors.ClockMediaUnusable),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown = undefined): ClockMediaUnusable {
		return retain(
			new ClockMediaUnusable(props(ClockErrors.ClockMediaUnusable, cause)),
			cause,
		);
	}
}
export class ClockMediaTooShort extends Schema.TaggedError<ClockMediaTooShort>()(
	"ClockMediaTooShort",
	fields(ClockErrors.ClockMediaTooShort),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown = undefined): ClockMediaTooShort {
		return retain(
			new ClockMediaTooShort(props(ClockErrors.ClockMediaTooShort, cause)),
			cause,
		);
	}
}
export type ClockError =
	| ClockConfigInvalid
	| ClockPersistenceFailed
	| ClockMediaUnusable
	| ClockMediaTooShort;
