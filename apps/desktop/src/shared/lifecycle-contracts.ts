import { Schema } from "effect";

export const LifecycleCommand = Schema.Union(
	Schema.Struct({ action: Schema.Literal("read") }),
	Schema.Struct({ action: Schema.Literal("redetect") }),
	Schema.Struct({ action: Schema.Literal("display-settings") }),
	Schema.Struct({ action: Schema.Literal("repair-layout") }),
);
export type LifecycleCommand = typeof LifecycleCommand.Type;
export const ConnectionDiagnostic = Schema.Struct({
	usb: Schema.Literal("pass", "fail"),
	hdmi: Schema.Literal("pass", "fail"),
	checking: Schema.Boolean,
	mock: Schema.Boolean,
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
	readonly displaySettingsAvailable: boolean;
	readonly layoutRepairAvailable: boolean;
	request(command: LifecycleCommand): Promise<LifecycleReply>;
	onStatus(listener: (status: ConnectionDiagnostic) => void): () => void;
}
export const LIFECYCLE_CHANNEL = "quake:lifecycle";
export const LIFECYCLE_STATUS = "quake:diagnostic";
