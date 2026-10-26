import { Schema } from "effect";
import { toSafeDiagnosticCause } from "../../../../../packages/edge/src/ai/ai-errors";

export const DesktopSpeechErrors = {
	NoDevice: {
		code: "VOICE.CAPTURE.NO_DEVICE",
		category: "dependency",
		message: "The selected microphone is unavailable",
	},
	RecorderUnavailable: {
		code: "VOICE.CAPTURE.RECORDER_UNAVAILABLE",
		category: "dependency",
		message: "The microphone recorder is unavailable",
	},
	PermissionDenied: {
		code: "VOICE.CAPTURE.PERMISSION_DENIED",
		category: "permission",
		message: "Microphone permission was denied",
	},
	BufferOverflow: {
		code: "VOICE.CAPTURE.BUFFER_OVERFLOW",
		category: "dependency",
		message: "The speech audio queue is full",
	},
	QueueFull: {
		code: "VOICE.TTS.QUEUE_FULL",
		category: "dependency",
		message: "The pending speech text queue is full",
	},
	PhaseTimeout: {
		code: "VOICE.CAPTURE.PHASE_TIMEOUT",
		category: "dependency",
		message: "The desktop speech phase timed out",
	},
} as const;
const entry = DesktopSpeechErrors;
const codes = [
	entry.NoDevice.code,
	entry.RecorderUnavailable.code,
	entry.PermissionDenied.code,
	entry.BufferOverflow.code,
	entry.QueueFull.code,
	entry.PhaseTimeout.code,
] as const;
/** Host-only failures preserve their original cause privately, never text/audio in JSON. */
export class DesktopSpeechError extends Schema.TaggedError<DesktopSpeechError>()(
	"DesktopSpeechError",
	{
		code: Schema.Literal(...codes),
		category: Schema.Literal("permission", "dependency"),
		message: Schema.String,
		phase: Schema.Literal(
			"permission",
			"session",
			"recorder",
			"capture",
			"speech",
		),
	},
) {
	declare readonly originalCause: unknown;
	constructor(
		reason: keyof typeof entry,
		phase: typeof DesktopSpeechError.prototype.phase,
		cause: unknown = undefined,
	) {
		super({ ...entry[reason], phase });
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
	toJSON() {
		return {
			_tag: this._tag,
			code: this.code,
			category: this.category,
			message: this.message,
			phase: this.phase,
			diagnosticCause: toSafeDiagnosticCause(this.originalCause),
		};
	}
}
