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
	ProfileForegroundFailed: {
		code: "QUAKE.PROFILE.FOREGROUND_FAILED",
		category: "dependency",
		message: "Reading the foreground application failed",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	ProfileCommandFailed: {
		code: "QUAKE.PROFILE.COMMAND_FAILED",
		category: "dependency",
		message: "Running the profile command failed",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	ProfileThumbnailFailed: {
		code: "QUAKE.PROFILE.THUMBNAIL_FAILED",
		category: "dependency",
		message: "Updating the profile thumbnail failed",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	ProfileThumbnailUnsupported: {
		code: "QUAKE.PROFILE.THUMBNAIL_UNSUPPORTED",
		category: "dependency",
		message: "Thumbnail generation is not supported on this system",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	ProfileDeliveryFailed: {
		code: "QUAKE.PROFILE.DELIVERY_FAILED",
		category: "dependency",
		message: "Delivering the selected profile failed",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
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
const fields = <const E extends Entry>(
	entry: E,
): {
	code: Schema.Literal<[E["code"]]>;
	category: Schema.Literal<[E["category"]]>;
	message: Schema.Literal<[E["message"]]>;
	diagnosticCause: typeof DiagnosticCause;
} => ({
	code: Schema.Literal(entry.code),
	category: Schema.Literal(entry.category),
	message: Schema.Literal(entry.message),
	diagnosticCause: DiagnosticCause,
});
const props = <const E extends Entry>(
	entry: E,
	cause: unknown,
): {
	code: E["code"];
	category: E["category"];
	message: E["message"];
	diagnosticCause: ReturnType<typeof toSafeDiagnosticCause>;
} => ({
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
export class ProfileForegroundFailed extends Schema.TaggedError<ProfileForegroundFailed>()(
	"ProfileForegroundFailed",
	fields(ProfileErrors.ProfileForegroundFailed),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown): ProfileForegroundFailed {
		const error = new ProfileForegroundFailed(
			props(ProfileErrors.ProfileForegroundFailed, cause),
		);
		retain(error, cause);
		return error;
	}
}
export class ProfileCommandFailed extends Schema.TaggedError<ProfileCommandFailed>()(
	"ProfileCommandFailed",
	fields(ProfileErrors.ProfileCommandFailed),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown): ProfileCommandFailed {
		const error = new ProfileCommandFailed(
			props(ProfileErrors.ProfileCommandFailed, cause),
		);
		retain(error, cause);
		return error;
	}
}
export class ProfileThumbnailFailed extends Schema.TaggedError<ProfileThumbnailFailed>()(
	"ProfileThumbnailFailed",
	fields(ProfileErrors.ProfileThumbnailFailed),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown): ProfileThumbnailFailed {
		const error = new ProfileThumbnailFailed(
			props(ProfileErrors.ProfileThumbnailFailed, cause),
		);
		retain(error, cause);
		return error;
	}
}
export class ProfileThumbnailUnsupported extends Schema.TaggedError<ProfileThumbnailUnsupported>()(
	"ProfileThumbnailUnsupported",
	fields(ProfileErrors.ProfileThumbnailUnsupported),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown): ProfileThumbnailUnsupported {
		const error = new ProfileThumbnailUnsupported(
			props(ProfileErrors.ProfileThumbnailUnsupported, cause),
		);
		retain(error, cause);
		return error;
	}
}
export class ProfileDeliveryFailed extends Schema.TaggedError<ProfileDeliveryFailed>()(
	"ProfileDeliveryFailed",
	fields(ProfileErrors.ProfileDeliveryFailed),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown): ProfileDeliveryFailed {
		const error = new ProfileDeliveryFailed(
			props(ProfileErrors.ProfileDeliveryFailed, cause),
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

export type ProfileSwitchingError =
	| ProfileRepositoryError
	| ProfileForegroundFailed
	| ProfileDeliveryFailed;
export type ProfileDesktopError =
	| ProfileSwitchingError
	| ProfileCommandFailed
	| ProfileThumbnailFailed
	| ProfileThumbnailUnsupported;
