import { Schema } from "effect";

export const MaintenanceErrors = {
	MaintenanceShutdownFailed: {
		code: "QUAKE.SETTINGS.SHUTDOWN_FAILED",
		category: "dependency",
		message: "Maintenance shutdown could not complete normally",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	FirmwareImageInvalid: {
		code: "QUAKE.FIRMWARE.IMAGE_INVALID",
		category: "dependency",
		message: "Firmware image is invalid",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	FirmwareTargetMismatch: {
		code: "QUAKE.FIRMWARE.TARGET_MISMATCH",
		category: "dependency",
		message: "Firmware target does not match",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	FirmwareVolumeInvalid: {
		code: "QUAKE.FIRMWARE.VOLUME_INVALID",
		category: "dependency",
		message: "Bootloader volume is invalid",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	FirmwareWriteFailed: {
		code: "QUAKE.FIRMWARE.WRITE_FAILED",
		category: "dependency",
		message: "Firmware write failed",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	FirmwareVerificationFailed: {
		code: "QUAKE.FIRMWARE.VERIFICATION_FAILED",
		category: "dependency",
		message: "Firmware verification failed",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	FirmwareUnavailable: {
		code: "QUAKE.FIRMWARE.UNAVAILABLE",
		category: "dependency",
		message: "Selected device is unavailable",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	FirmwareBusy: {
		code: "QUAKE.FIRMWARE.BUSY",
		category: "dependency",
		message: "An update is already running",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	FirmwarePersistenceFailed: {
		code: "QUAKE.FIRMWARE.PERSIST_FAILED",
		category: "dependency",
		message: "Firmware recovery record could not be saved",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	BackupInvalid: {
		code: "QUAKE.BACKUP.INVALID",
		category: "dependency",
		message: "Backup is invalid or cannot be authenticated",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	BackupFailed: {
		code: "QUAKE.BACKUP.FAILED",
		category: "dependency",
		message: "Backup could not be completed",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	RestoreFailed: {
		code: "QUAKE.BACKUP.RESTORE_FAILED",
		category: "dependency",
		message: "Backup could not be restored",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	ResetFailed: {
		code: "QUAKE.SETTINGS.RESET_FAILED",
		category: "dependency",
		message: "Failed to clear data. Please try again.",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	PermissionProbeFailed: {
		code: "QUAKE.SETTINGS.PERMISSION_PROBE_FAILED",
		category: "dependency",
		message: "Permission status is unknown",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	AppUpdateFailed: {
		code: "QUAKE.APP.UPDATE_FAILED",
		category: "dependency",
		message: "App update failed",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
} as const;
type Entry = (typeof MaintenanceErrors)[keyof typeof MaintenanceErrors];
const fields = <const E extends Entry>(e: E) => ({
	code: Schema.Literal(e.code),
	category: Schema.Literal(e.category),
	message: Schema.Literal(e.message),
	diagnosticCause: Schema.Struct({
		name: Schema.Literal("MaintenanceBoundary"),
	}),
});
const props = <const E extends Entry>(e: E) => ({
	...e,
	diagnosticCause: { name: "MaintenanceBoundary" as const },
});
const retain = (target: object, cause: unknown): void => {
	Object.defineProperty(target, "originalCause", {
		value: cause,
		enumerable: false,
	});
};
export class MaintenanceShutdownFailed extends Schema.TaggedError<MaintenanceShutdownFailed>()(
	"MaintenanceShutdownFailed",
	fields(MaintenanceErrors.MaintenanceShutdownFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(MaintenanceErrors.MaintenanceShutdownFailed));
		retain(this, cause);
	}
}
export class FirmwareImageInvalid extends Schema.TaggedError<FirmwareImageInvalid>()(
	"FirmwareImageInvalid",
	fields(MaintenanceErrors.FirmwareImageInvalid),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MaintenanceErrors.FirmwareImageInvalid));
		retain(this, cause);
	}
}
export class FirmwareTargetMismatch extends Schema.TaggedError<FirmwareTargetMismatch>()(
	"FirmwareTargetMismatch",
	fields(MaintenanceErrors.FirmwareTargetMismatch),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MaintenanceErrors.FirmwareTargetMismatch));
		retain(this, cause);
	}
}
export class FirmwareVolumeInvalid extends Schema.TaggedError<FirmwareVolumeInvalid>()(
	"FirmwareVolumeInvalid",
	fields(MaintenanceErrors.FirmwareVolumeInvalid),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MaintenanceErrors.FirmwareVolumeInvalid));
		retain(this, cause);
	}
}
export class FirmwareWriteFailed extends Schema.TaggedError<FirmwareWriteFailed>()(
	"FirmwareWriteFailed",
	fields(MaintenanceErrors.FirmwareWriteFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MaintenanceErrors.FirmwareWriteFailed));
		retain(this, cause);
	}
}
export class FirmwareVerificationFailed extends Schema.TaggedError<FirmwareVerificationFailed>()(
	"FirmwareVerificationFailed",
	fields(MaintenanceErrors.FirmwareVerificationFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MaintenanceErrors.FirmwareVerificationFailed));
		retain(this, cause);
	}
}
export class FirmwareUnavailable extends Schema.TaggedError<FirmwareUnavailable>()(
	"FirmwareUnavailable",
	fields(MaintenanceErrors.FirmwareUnavailable),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MaintenanceErrors.FirmwareUnavailable));
		retain(this, cause);
	}
}
export class FirmwareBusy extends Schema.TaggedError<FirmwareBusy>()(
	"FirmwareBusy",
	fields(MaintenanceErrors.FirmwareBusy),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MaintenanceErrors.FirmwareBusy));
		retain(this, cause);
	}
}
export class FirmwarePersistenceFailed extends Schema.TaggedError<FirmwarePersistenceFailed>()(
	"FirmwarePersistenceFailed",
	fields(MaintenanceErrors.FirmwarePersistenceFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MaintenanceErrors.FirmwarePersistenceFailed));
		retain(this, cause);
	}
}
export class BackupInvalid extends Schema.TaggedError<BackupInvalid>()(
	"BackupInvalid",
	fields(MaintenanceErrors.BackupInvalid),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MaintenanceErrors.BackupInvalid));
		retain(this, cause);
	}
}
export class BackupFailed extends Schema.TaggedError<BackupFailed>()(
	"BackupFailed",
	fields(MaintenanceErrors.BackupFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MaintenanceErrors.BackupFailed));
		retain(this, cause);
	}
}
export class RestoreFailed extends Schema.TaggedError<RestoreFailed>()(
	"RestoreFailed",
	fields(MaintenanceErrors.RestoreFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MaintenanceErrors.RestoreFailed));
		retain(this, cause);
	}
}
export class ResetFailed extends Schema.TaggedError<ResetFailed>()(
	"ResetFailed",
	fields(MaintenanceErrors.ResetFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MaintenanceErrors.ResetFailed));
		retain(this, cause);
	}
}
export class PermissionProbeFailed extends Schema.TaggedError<PermissionProbeFailed>()(
	"PermissionProbeFailed",
	fields(MaintenanceErrors.PermissionProbeFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MaintenanceErrors.PermissionProbeFailed));
		retain(this, cause);
	}
}
export class AppUpdateFailed extends Schema.TaggedError<AppUpdateFailed>()(
	"AppUpdateFailed",
	fields(MaintenanceErrors.AppUpdateFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(MaintenanceErrors.AppUpdateFailed));
		retain(this, cause);
	}
}
export type MaintenanceError =
	| MaintenanceShutdownFailed
	| FirmwareImageInvalid
	| FirmwareTargetMismatch
	| FirmwareVolumeInvalid
	| FirmwareWriteFailed
	| FirmwareVerificationFailed
	| FirmwareUnavailable
	| FirmwareBusy
	| FirmwarePersistenceFailed
	| BackupInvalid
	| BackupFailed
	| RestoreFailed
	| ResetFailed
	| PermissionProbeFailed
	| AppUpdateFailed;
