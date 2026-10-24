import { Schema } from "effect";
import { toSafeDiagnosticCause } from "../../../../packages/device/src/device-errors";
export const MonitorErrors = {
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
	diagnosticCause: Schema.Unknown,
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
	constructor(cause: unknown = undefined) {
		super(props(MonitorErrors.ConfigInvalid, cause));
		retain(this, cause);
	}
}
export class MonitorPersistenceFailed extends Schema.TaggedError<MonitorPersistenceFailed>()(
	"MonitorPersistenceFailed",
	fields(MonitorErrors.PersistenceFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(MonitorErrors.PersistenceFailed, cause));
		retain(this, cause);
	}
}
export class MonitorMediaUnusable extends Schema.TaggedError<MonitorMediaUnusable>()(
	"MonitorMediaUnusable",
	fields(MonitorErrors.MediaUnusable),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MonitorErrors.MediaUnusable, cause));
		retain(this, cause);
	}
}
export class MonitorCollectionFailed extends Schema.TaggedError<MonitorCollectionFailed>()(
	"MonitorCollectionFailed",
	fields(MonitorErrors.CollectionFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(MonitorErrors.CollectionFailed, cause));
		retain(this, cause);
	}
}
export class MonitorVideoTooShort extends Schema.TaggedError<MonitorVideoTooShort>()(
	"MonitorVideoTooShort",
	fields(MonitorErrors.VideoTooShort),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MonitorErrors.VideoTooShort, cause));
		retain(this, cause);
	}
}
