import { Schema } from "effect";
export const Version = Schema.String.pipe(Schema.pattern(/^\d+\.\d+\.\d+$/));
export const RecoverySerial = Schema.String.pipe(
	Schema.pattern(/^[A-Za-z0-9._:-]{1,128}$/),
);
export const FirmwareState = Schema.Literal(
	"idle",
	"checking",
	"entering_download_mode",
	"waiting_volume",
	"ready_to_write",
	"copying",
	"written_unverified",
	"verifying",
	"success",
	"failed",
	"needs_recovery",
);
export const FirmwareSnapshot = Schema.Struct({
	state: FirmwareState,
	serial: Schema.String,
	from: Schema.String,
	to: Schema.String,
	fileName: Schema.String,
	fingerprint: Schema.String,
	step: Schema.Int.pipe(Schema.between(0, 3)),
	copied: Schema.NonNegativeInt,
	total: Schema.NonNegativeInt,
	reason: Schema.String,
	volumes: Schema.Array(
		Schema.Struct({ id: Schema.String, label: Schema.String }),
	),
	endedAt: Schema.Number,
});
export type FirmwareSnapshot = typeof FirmwareSnapshot.Type;
export const idleFirmware: FirmwareSnapshot = {
	state: "idle",
	serial: "",
	from: "",
	to: "",
	fileName: "",
	fingerprint: "",
	step: 0,
	copied: 0,
	total: 0,
	reason: "",
	volumes: [],
	endedAt: 0,
};
export const runningFirmware = (s: FirmwareSnapshot): boolean =>
	!["idle", "success", "failed", "needs_recovery"].includes(s.state);
export const PermissionKey = Schema.Literal(
	"accessibility",
	"inputMonitoring",
	"microphone",
	"screenRecording",
	"systemAudio",
);
export type PermissionKey = typeof PermissionKey.Type;
export const PermissionStatus = Schema.Literal(
	"granted",
	"denied",
	"unknown",
	"unsupported",
);
export const PermissionRow = Schema.Struct({
	key: PermissionKey,
	status: PermissionStatus,
});
export type PermissionRow = typeof PermissionRow.Type;
export const AppUpdateSnapshot = Schema.Struct({
	state: Schema.Literal(
		"disabled",
		"idle",
		"checking",
		"available",
		"downloading",
		"ready",
		"installing",
		"failed",
		"up_to_date",
	),
	version: Schema.String,
	progress: Schema.Number,
	reason: Schema.String,
	prompt: Schema.Boolean,
});
export type AppUpdateSnapshot = typeof AppUpdateSnapshot.Type;
export const MaintenanceCommand = Schema.Union(
	Schema.Struct({
		action: Schema.Literal(
			"read",
			"firmware-inspect",
			"firmware-start",
			"firmware-close",
			"firmware-cancel",
			"export",
			"import",
			"check-update",
			"download-update",
			"install-update",
			"defer-update",
			"appearance-read",
		),
	}),
	Schema.Struct({
		action: Schema.Literal("firmware-write"),
		volumeId: Schema.String,
	}),
	Schema.Struct({ action: Schema.Literal("permission"), key: PermissionKey }),
	Schema.Struct({ action: Schema.Literal("reset"), backup: Schema.Boolean }),
	Schema.Struct({
		action: Schema.Literal("appearance-applied"),
		record: Schema.String.pipe(Schema.maxLength(20480)),
	}),
	Schema.Struct({
		action: Schema.Literal("firmware-recover"),
		serial: RecoverySerial,
	}),
);
export type MaintenanceCommand = typeof MaintenanceCommand.Type;
export const MaintenanceView = Schema.Struct({
	firmware: FirmwareSnapshot,
	currentVersion: Schema.String,
	serial: Schema.String,
	imageVersion: Schema.String,
	imageTrusted: Schema.Boolean,
	permissions: Schema.Array(PermissionRow),
	macOS: Schema.Boolean,
	appVersion: Schema.String,
	update: AppUpdateSnapshot,
});
export type MaintenanceView = typeof MaintenanceView.Type;
export const MaintenanceReply = Schema.Union(
	Schema.Struct({
		ok: Schema.Literal(true),
		view: MaintenanceView,
		message: Schema.String,
		appearance: Schema.optional(Schema.String.pipe(Schema.maxLength(20480))),
	}),
	Schema.Struct({ ok: Schema.Literal(false), code: Schema.String }),
);
export type MaintenanceReply = typeof MaintenanceReply.Type;
export const MAINTENANCE_CHANNEL = "maintenance:request";
/** Single action declaration used by the IPC decoder and future automation. Sensitive actions use native confirmation. */
export const maintenanceCapabilities = {
	"firmware-start": "confirm",
	"firmware-recover": "confirm",
	"firmware-write": "confirm",
	reset: "confirm",
	import: "confirm",
	export: "confirm",
	permission: "confirm",
	"install-update": "confirm",
	read: "auto",
	"firmware-inspect": "confirm",
	"firmware-close": "auto",
	"firmware-cancel": "auto",
	"check-update": "auto",
	"download-update": "confirm",
	"defer-update": "auto",
	"appearance-read": "auto",
	"appearance-applied": "auto",
} as const;
export function newerVersion(a: string, b: string): boolean {
	if (!Schema.is(Version)(a) || !Schema.is(Version)(b)) return false;
	const aa = a.split(".").map(Number);
	const bb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const d = (aa[i] ?? 0) - (bb[i] ?? 0);
		if (d) return d > 0;
	}
	return false;
}
