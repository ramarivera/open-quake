import { Schema } from "effect";
import { DiagnosticCause, toSafeDiagnosticCause } from "../ai/ai-errors.js";

const policy = {
	userFacing: true,
	userRecoverable: true,
	retry: "manual" as const,
};
export const AudioOutputErrors = {
	Busy: {
		code: "QUAKE.AUDIO.OUTPUT_BUSY",
		category: "conflict",
		message: "Audio output is already in use",
		policy,
	},
	Failed: {
		code: "QUAKE.AUDIO.OUTPUT_FAILED",
		category: "dependency",
		message: "Audio output could not be released safely",
		policy,
	},
} as const;
const fields = <const K extends keyof typeof AudioOutputErrors>(key: K) => ({
	code: Schema.Literal(AudioOutputErrors[key].code),
	category: Schema.Literal(AudioOutputErrors[key].category),
	message: Schema.Literal(AudioOutputErrors[key].message),
	diagnosticCause: DiagnosticCause,
});
export class AudioOutputBusy extends Schema.TaggedError<AudioOutputBusy>()(
	"AudioOutputBusy",
	fields("Busy"),
) {
	declare readonly originalCause: unknown;
	constructor(cause?: unknown, decoded = false) {
		super(
			decoded
				? Schema.decodeUnknownSync(Schema.Struct(fields("Busy")))(cause)
				: {
						...AudioOutputErrors.Busy,
						diagnosticCause: toSafeDiagnosticCause(cause),
					},
		);
		Object.defineProperty(this, "originalCause", {
			value: decoded ? undefined : cause,
			enumerable: false,
		});
	}
}
export class AudioOutputFailed extends Schema.TaggedError<AudioOutputFailed>()(
	"AudioOutputFailed",
	fields("Failed"),
) {
	declare readonly originalCause: unknown;
	constructor(cause?: unknown, decoded = false) {
		super(
			decoded
				? Schema.decodeUnknownSync(Schema.Struct(fields("Failed")))(cause)
				: {
						...AudioOutputErrors.Failed,
						diagnosticCause: toSafeDiagnosticCause(cause),
					},
		);
		Object.defineProperty(this, "originalCause", {
			value: decoded ? undefined : cause,
			enumerable: false,
		});
	}
}
export type AudioOutputError = AudioOutputBusy | AudioOutputFailed;
