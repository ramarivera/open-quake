import { Schema } from "effect";
import { toSafeDiagnosticCause } from "../../../../../../packages/device/src/device-errors";

const policy = {
	userFacing: true,
	userRecoverable: true,
	retry: "automatic",
} as const;
export const SystemMediaErrors = {
	MediaHelperUnavailable: {
		code: "QUAKE.MEDIA.HELPER_UNAVAILABLE",
		category: "dependency",
		message: "The native media helper is unavailable",
		policy,
	},
	MediaProcessFailed: {
		code: "QUAKE.MEDIA.PROCESS_FAILED",
		category: "dependency",
		message: "The native media request failed",
		policy,
	},
	MediaResponseInvalid: {
		code: "QUAKE.MEDIA.RESPONSE_INVALID",
		category: "dependency",
		message: "The native media response is invalid",
		policy,
	},
} as const;
const fields = <const C extends string, const M extends string>(entry: {
	code: C;
	message: M;
}) => ({
	code: Schema.Literal(entry.code),
	category: Schema.Literal("dependency"),
	message: Schema.Literal(entry.message),
});
const retain = <T extends object>(error: T, cause: unknown): T => {
	Object.defineProperty(error, "originalCause", {
		value: cause,
		enumerable: false,
	});
	Object.defineProperty(error, "diagnosticCause", {
		value: toSafeDiagnosticCause(cause),
		enumerable: true,
	});
	return error;
};
export class MediaHelperUnavailable extends Schema.TaggedError<MediaHelperUnavailable>()(
	"MediaHelperUnavailable",
	fields(SystemMediaErrors.MediaHelperUnavailable),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown) {
		return retain(
			new MediaHelperUnavailable(SystemMediaErrors.MediaHelperUnavailable),
			cause,
		);
	}
}
export class MediaProcessFailed extends Schema.TaggedError<MediaProcessFailed>()(
	"MediaProcessFailed",
	fields(SystemMediaErrors.MediaProcessFailed),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown) {
		return retain(
			new MediaProcessFailed(SystemMediaErrors.MediaProcessFailed),
			cause,
		);
	}
}
export class MediaResponseInvalid extends Schema.TaggedError<MediaResponseInvalid>()(
	"MediaResponseInvalid",
	fields(SystemMediaErrors.MediaResponseInvalid),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown) {
		return retain(
			new MediaResponseInvalid(SystemMediaErrors.MediaResponseInvalid),
			cause,
		);
	}
}
export type SystemMediaError =
	| MediaHelperUnavailable
	| MediaProcessFailed
	| MediaResponseInvalid;
