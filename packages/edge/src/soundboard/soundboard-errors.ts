import { Schema } from "effect";
import { DiagnosticCause, toSafeDiagnosticCause } from "../ai/ai-errors.js";

const policy = {
	userFacing: true,
	userRecoverable: true,
	retry: "manual" as const,
};
export const SoundboardErrors = {
	ConfigInvalid: {
		code: "QUAKE.AUDIO.CONFIG_INVALID",
		category: "validation",
		message: "The local audio configuration is invalid",
		policy,
	},
	FileUnavailable: {
		code: "QUAKE.AUDIO.FILE_UNAVAILABLE",
		category: "dependency",
		message: "A local audio file is unavailable",
		policy,
	},
} as const;
const fields = <const K extends keyof typeof SoundboardErrors>(key: K) => ({
	code: Schema.Literal(SoundboardErrors[key].code),
	category: Schema.Literal(SoundboardErrors[key].category),
	message: Schema.Literal(SoundboardErrors[key].message),
	diagnosticCause: DiagnosticCause,
});
const properties = <const K extends keyof typeof SoundboardErrors>(
	key: K,
	cause: unknown,
) => ({
	...SoundboardErrors[key],
	diagnosticCause: toSafeDiagnosticCause(cause),
});
export class SoundboardConfigInvalid extends Schema.TaggedError<SoundboardConfigInvalid>()(
	"SoundboardConfigInvalid",
	fields("ConfigInvalid"),
) {
	declare readonly originalCause: unknown;
	constructor(cause?: unknown, decoded = false) {
		super(
			decoded
				? Schema.decodeUnknownSync(Schema.Struct(fields("ConfigInvalid")))(
						cause,
					)
				: properties("ConfigInvalid", cause),
		);
		Object.defineProperty(this, "originalCause", {
			value: decoded ? undefined : cause,
			enumerable: false,
		});
	}
}
export class SoundboardFileUnavailable extends Schema.TaggedError<SoundboardFileUnavailable>()(
	"SoundboardFileUnavailable",
	fields("FileUnavailable"),
) {
	declare readonly originalCause: unknown;
	constructor(cause?: unknown, decoded = false) {
		super(
			decoded
				? Schema.decodeUnknownSync(Schema.Struct(fields("FileUnavailable")))(
						cause,
					)
				: properties("FileUnavailable", cause),
		);
		Object.defineProperty(this, "originalCause", {
			value: decoded ? undefined : cause,
			enumerable: false,
		});
	}
}
