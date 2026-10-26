import { Schema } from "effect";
import { DiagnosticCause, toSafeDiagnosticCause } from "../ai/ai-errors.js";
export const MonitorErrors = {
	PermissionDenied: {
		code: "QUAKE.MONITOR.PERMISSION_DENIED",
		category: "permission",
		message: "Foreground monitoring permission was denied",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	ConfigInvalid: {
		code: "QUAKE.MONITOR.CONFIG_INVALID",
		category: "validation",
		message: "Monitor settings are invalid",
		policy: { userFacing: true, userRecoverable: true, retry: "never" },
	},
	PersistenceFailed: {
		code: "QUAKE.MONITOR.PERSISTENCE_FAILED",
		category: "dependency",
		message:
			"Monitor settings could not be saved; the previous settings were kept",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	MediaUnusable: {
		code: "QUAKE.MONITOR.MEDIA_UNUSABLE",
		category: "validation",
		message: "Background file is missing; reverted to the built-in background",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	VideoTooShort: {
		code: "QUAKE.MONITOR.VIDEO_TOO_SHORT",
		category: "validation",
		message: "Video duration too short, should be longer than 2 seconds.",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	CollectionFailed: {
		code: "QUAKE.MONITOR.COLLECTION_FAILED",
		category: "dependency",
		message: "Monitor collection failed",
		policy: { userFacing: false, userRecoverable: true, retry: "automatic" },
	},
} as const;
type Entry = (typeof MonitorErrors)[keyof typeof MonitorErrors];
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
const retain = (target: object, cause: unknown): void => {
	Object.defineProperty(target, "originalCause", {
		value: cause,
		enumerable: false,
	});
};
export class MonitorConfigInvalid extends Schema.TaggedError<MonitorConfigInvalid>()(
	"MonitorConfigInvalid",
	fields(MonitorErrors.ConfigInvalid),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined, decoded = false) {
		super(
			decoded
				? Schema.decodeUnknownSync(
						Schema.Struct(fields(MonitorErrors.ConfigInvalid)),
					)(cause)
				: props(MonitorErrors.ConfigInvalid, cause),
		);
		retain(this, decoded ? undefined : cause);
	}
}
export class MonitorPersistenceFailed extends Schema.TaggedError<MonitorPersistenceFailed>()(
	"MonitorPersistenceFailed",
	fields(MonitorErrors.PersistenceFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined, decoded = false) {
		super(
			decoded
				? Schema.decodeUnknownSync(
						Schema.Struct(fields(MonitorErrors.PersistenceFailed)),
					)(cause)
				: props(MonitorErrors.PersistenceFailed, cause),
		);
		retain(this, decoded ? undefined : cause);
	}
}
export class MonitorMediaUnusable extends Schema.TaggedError<MonitorMediaUnusable>()(
	"MonitorMediaUnusable",
	fields(MonitorErrors.MediaUnusable),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined, decoded = false) {
		super(
			decoded
				? Schema.decodeUnknownSync(
						Schema.Struct(fields(MonitorErrors.MediaUnusable)),
					)(cause)
				: props(MonitorErrors.MediaUnusable, cause),
		);
		retain(this, decoded ? undefined : cause);
	}
}
export class MonitorCollectionFailed extends Schema.TaggedError<MonitorCollectionFailed>()(
	"MonitorCollectionFailed",
	fields(MonitorErrors.CollectionFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined, decoded = false) {
		super(
			decoded
				? Schema.decodeUnknownSync(
						Schema.Struct(fields(MonitorErrors.CollectionFailed)),
					)(cause)
				: props(MonitorErrors.CollectionFailed, cause),
		);
		retain(this, decoded ? undefined : cause);
	}
}
export class MonitorVideoTooShort extends Schema.TaggedError<MonitorVideoTooShort>()(
	"MonitorVideoTooShort",
	fields(MonitorErrors.VideoTooShort),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined, decoded = false) {
		super(
			decoded
				? Schema.decodeUnknownSync(
						Schema.Struct(fields(MonitorErrors.VideoTooShort)),
					)(cause)
				: props(MonitorErrors.VideoTooShort, cause),
		);
		retain(this, decoded ? undefined : cause);
	}
}

export class MonitorPermissionDenied extends Schema.TaggedError<MonitorPermissionDenied>()(
	"MonitorPermissionDenied",
	fields(MonitorErrors.PermissionDenied),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined, decoded = false) {
		super(
			decoded
				? Schema.decodeUnknownSync(
						Schema.Struct(fields(MonitorErrors.PermissionDenied)),
					)(cause)
				: props(MonitorErrors.PermissionDenied, cause),
		);
		retain(this, decoded ? undefined : cause);
	}
}
