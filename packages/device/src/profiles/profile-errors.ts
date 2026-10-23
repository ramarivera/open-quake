import { Schema } from "effect";
import { toSafeDiagnosticCause } from "../device-errors.js";

/** Domain additions to the package catalog; never includes user payloads. */
export const ProfileErrors = {
	ProfileValidationFailed: {
		code: "QUAKE.PROFILE.VALIDATION_FAILED",
		category: "validation",
		message: "The profile data is invalid",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	ProfileNotFound: {
		code: "QUAKE.PROFILE.NOT_FOUND",
		category: "unavailable",
		message: "The requested profile does not exist",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	ProfileRevisionConflict: {
		code: "QUAKE.PROFILE.REVISION_CONFLICT",
		category: "conflict",
		message: "The profile revision has changed",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	ProfileReadFailed: {
		code: "QUAKE.PROFILE.READ_FAILED",
		category: "dependency",
		message: "Reading local profiles failed",
		policy: { userFacing: false, userRecoverable: true, retry: "manual" },
	},
	ProfileWriteFailed: {
		code: "QUAKE.PROFILE.WRITE_FAILED",
		category: "dependency",
		message: "Saving local profiles failed",
		policy: { userFacing: false, userRecoverable: true, retry: "manual" },
	},
} as const;
const DiagnosticCause: Schema.Schema<ReturnType<typeof toSafeDiagnosticCause>> =
	Schema.suspend(() =>
		Schema.Struct({
			name: Schema.String,
			sourceCode: Schema.optionalWith(Schema.String, { exact: true }),
			cause: Schema.optionalWith(DiagnosticCause, { exact: true }),
			truncated: Schema.Boolean,
		}),
	);
type Entry = (typeof ProfileErrors)[keyof typeof ProfileErrors];
const fields = <const E extends Entry>(entry: E) => ({
	code: Schema.Literal(entry.code),
	category: Schema.Literal(entry.category),
	message: Schema.Literal(entry.message),
	diagnosticCause: DiagnosticCause,
});
const props = <const E extends Entry>(entry: E, cause: unknown) => ({
	code: entry.code,
	category: entry.category,
	message: entry.message,
	diagnosticCause: toSafeDiagnosticCause(cause),
});
const retain = (error: object, cause: unknown): void => {
	Object.defineProperty(error, "originalCause", {
		value: cause,
		enumerable: false,
	});
};
const publicFields = new Set([
	"expectedRevision",
	"profile",
	"schemaVersion",
	"profiles",
	"activeByDevice",
	"profileId",
	"pageId",
	"id",
	"name",
	"revision",
	"pages",
	"keys",
	"knob",
	"keyCode",
	"childrenName",
	"compatibility",
	"config",
	"type",
	"title",
	"text",
	"pos",
	"size",
	"color",
	"display",
	"style",
	"resourceId",
	"supportKnob",
	"supportTouchEffect",
	"icon",
	"alterTitle",
	"alterIcon",
	"actions",
	"value",
	"subActions",
	"basicEditableItems",
	"grid",
	"allowDelete",
	"allowDrag",
]);
const safePaths = (paths: ReadonlyArray<ReadonlyArray<string | number>>) =>
	paths
		.slice(0, 64)
		.map((path) =>
			path
				.slice(0, 16)
				.map((part) =>
					typeof part === "number" ? part : publicFields.has(part) ? part : "*",
				),
		);
// Keep Schema's constructors intact so decoding preserves all public fields.
export class ProfileValidationFailed extends Schema.TaggedError<ProfileValidationFailed>()(
	"ProfileValidationFailed",
	{
		...fields(ProfileErrors.ProfileValidationFailed),
		paths: Schema.Array(
			Schema.Array(Schema.Union(Schema.String, Schema.Number)),
		),
	},
) {
	declare readonly originalCause: unknown;
	static fromCause(
		cause: unknown,
		paths: ReadonlyArray<ReadonlyArray<string | number>> = [],
	): ProfileValidationFailed {
		const error = new ProfileValidationFailed({
			...props(ProfileErrors.ProfileValidationFailed, cause),
			paths: safePaths(paths),
		});
		retain(error, cause);
		return error;
	}
}
export class ProfileNotFound extends Schema.TaggedError<ProfileNotFound>()(
	"ProfileNotFound",
	fields(ProfileErrors.ProfileNotFound),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown): ProfileNotFound {
		const error = new ProfileNotFound(
			props(ProfileErrors.ProfileNotFound, cause),
		);
		retain(error, cause);
		return error;
	}
}
export class ProfileRevisionConflict extends Schema.TaggedError<ProfileRevisionConflict>()(
	"ProfileRevisionConflict",
	{
		...fields(ProfileErrors.ProfileRevisionConflict),
		expectedRevision: Schema.Number,
		actualRevision: Schema.Number,
	},
) {
	declare readonly originalCause: unknown;
	static forRevisions(
		expectedRevision: number,
		actualRevision: number,
	): ProfileRevisionConflict {
		const error = new ProfileRevisionConflict({
			...props(ProfileErrors.ProfileRevisionConflict, undefined),
			expectedRevision,
			actualRevision,
		});
		retain(error, undefined);
		return error;
	}
}
export class ProfileReadFailed extends Schema.TaggedError<ProfileReadFailed>()(
	"ProfileReadFailed",
	fields(ProfileErrors.ProfileReadFailed),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown): ProfileReadFailed {
		const error = new ProfileReadFailed(
			props(ProfileErrors.ProfileReadFailed, cause),
		);
		retain(error, cause);
		return error;
	}
}
export class ProfileWriteFailed extends Schema.TaggedError<ProfileWriteFailed>()(
	"ProfileWriteFailed",
	fields(ProfileErrors.ProfileWriteFailed),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown): ProfileWriteFailed {
		const error = new ProfileWriteFailed(
			props(ProfileErrors.ProfileWriteFailed, cause),
		);
		retain(error, cause);
		return error;
	}
}
export type ProfileRepositoryError =
	| ProfileReadFailed
	| ProfileWriteFailed
	| ProfileValidationFailed
	| ProfileNotFound
	| ProfileRevisionConflict;
