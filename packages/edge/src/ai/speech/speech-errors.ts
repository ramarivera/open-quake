import { Schema } from "effect";
import { toSafeDiagnosticCause } from "../ai-errors.js";

export const SpeechErrors = {
	FormatUnsupported: {
		code: "VOICE.TTS.FORMAT_UNSUPPORTED",
		category: "validation",
		message: "The speech audio format is unsupported",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	PhaseTimeout: {
		code: "VOICE.CAPTURE.PHASE_TIMEOUT",
		category: "dependency",
		message: "The speech phase timed out",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
} as const;
const format = SpeechErrors.FormatUnsupported;
export class SpeechFormatUnsupported extends Schema.TaggedError<SpeechFormatUnsupported>()(
	"SpeechFormatUnsupported",
	{
		code: Schema.Literal(format.code),
		category: Schema.Literal(format.category),
		message: Schema.Literal(format.message),
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({
			code: format.code,
			category: format.category,
			message: format.message,
		});
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
			diagnosticCause: toSafeDiagnosticCause(this.originalCause),
		};
	}
}
const timeout = SpeechErrors.PhaseTimeout;
export class SpeechPhaseTimeout extends Schema.TaggedError<SpeechPhaseTimeout>()(
	"SpeechPhaseTimeout",
	{
		code: Schema.Literal(timeout.code),
		category: Schema.Literal(timeout.category),
		message: Schema.Literal(timeout.message),
		phase: Schema.Literal(
			"connect",
			"configure",
			"final",
			"synthesis",
			"playerReady",
			"playback",
		),
	},
) {
	constructor(phase: typeof SpeechPhaseTimeout.prototype.phase) {
		super({
			code: timeout.code,
			category: timeout.category,
			message: timeout.message,
			phase,
		});
	}
}
