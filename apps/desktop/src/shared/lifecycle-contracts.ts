import { Schema } from "effect";

export const LifecycleCommand = Schema.Union(
	Schema.Struct({ action: Schema.Literal("read") }),
	Schema.Struct({ action: Schema.Literal("wizard"), open: Schema.Boolean }),
	Schema.Struct({ action: Schema.Literal("redetect") }),
	Schema.Struct({ action: Schema.Literal("bind-all") }),
	Schema.Struct({
		action: Schema.Literal("restart"),
		serial: Schema.Trimmed.pipe(Schema.nonEmptyString(), Schema.maxLength(256)),
	}),
	Schema.Struct({ action: Schema.Literal("display-settings") }),
	Schema.Struct({ action: Schema.Literal("repair-layout") }),
);
export type LifecycleCommand = typeof LifecycleCommand.Type;
export const DisplayOrientation = Schema.Struct({
	serialNumber: Schema.String,
	rotation: Schema.Number,
	isVertical: Schema.Boolean,
	orientation: Schema.Literal("horizontal", "vertical"),
	connected: Schema.Boolean,
});
export type DisplayOrientation = typeof DisplayOrientation.Type;
export const NativeDisplayEvidence = Schema.Struct({
	source: Schema.Literal("none", "wmi-name", "forms-size"),
	present: Schema.Boolean,
	width: Schema.Number,
	height: Schema.Number,
	failed: Schema.Boolean,
});
export type NativeDisplayEvidence = typeof NativeDisplayEvidence.Type;
export const ConnectionDiagnostic = Schema.Struct({
	usb: Schema.Literal("pass", "fail"),
	hdmi: Schema.Literal("pass", "fail"),
	checking: Schema.Boolean,
	mock: Schema.Boolean,
	orientations: Schema.optional(Schema.Array(DisplayOrientation)),
	alert: Schema.optional(
		Schema.Struct({
			alertType: Schema.Literal("multi-screen"),
			deviceSNs: Schema.Array(Schema.String),
		}),
	),
	native: Schema.optional(NativeDisplayEvidence),
	layout: Schema.optional(
		Schema.Array(
			Schema.Struct({
				id: Schema.Number,
				x: Schema.Number,
				y: Schema.Number,
				width: Schema.Number,
				height: Schema.Number,
				strip: Schema.Boolean,
				order: Schema.Number,
			}),
		),
	),
	width: Schema.Number,
	height: Schema.Number,
	resolutionMismatch: Schema.Boolean,
	issue: Schema.Literal(
		"none",
		"unavailable",
		"timeout",
		"power-failed",
		"native-failed",
	),
});
export type ConnectionDiagnostic = typeof ConnectionDiagnostic.Type;
export const LifecycleReply = Schema.Union(
	Schema.Struct({ ok: Schema.Literal(true), status: ConnectionDiagnostic }),
	Schema.Struct({
		ok: Schema.Literal(false),
		code: Schema.Literal(
			"DESKTOP.LIFECYCLE.FORBIDDEN",
			"DESKTOP.LIFECYCLE.INVALID",
			"DESKTOP.DISPLAY.OPERATION_FAILED",
		),
	}),
);
export type LifecycleReply = typeof LifecycleReply.Type;
export interface LifecycleBridge {
	readonly platform?: string;
	readonly displaySettingsAvailable: boolean;
	readonly layoutRepairAvailable: boolean;
	request(command: LifecycleCommand): Promise<LifecycleReply>;
	onStatus(listener: (status: ConnectionDiagnostic) => void): () => void;
}
export const LIFECYCLE_CHANNEL = "quake:lifecycle";
export const LIFECYCLE_STATUS = "quake:diagnostic";
