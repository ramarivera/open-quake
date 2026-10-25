import { Schema } from "effect";
import { DiagnosticCause, toSafeDiagnosticCause } from "../ai/ai-errors.js";

const definition = <const C extends string, const M extends string>(
	code: C,
	message: M,
) => ({
	code,
	message,
	category: "dependency" as const,
	policy: { userFacing: true, userRecoverable: true, retry: "manual" as const },
});
export const MeetingErrors = {
	ConverterUnavailable: definition(
		"QUAKE.MEETING.CONVERTER_UNAVAILABLE",
		"Recording requires FFmpeg with the libmp3lame encoder. Install it and restart open-quake, or set OPEN_QUAKE_FFMPEG to its executable path.",
	),
	CaptureDenied: definition(
		"QUAKE.MEETING.CAPTURE_DENIED",
		"Meeting capture permission was denied",
	),
	SourceLost: definition(
		"QUAKE.MEETING.SOURCE_LOST",
		"The selected meeting audio source was lost",
	),
	CaptureFailed: definition(
		"QUAKE.MEETING.CAPTURE_FAILED",
		"Meeting audio capture failed",
	),
	TranscriptionFailed: definition(
		"QUAKE.MEETING.TRANSCRIPTION_FAILED",
		"Meeting transcription failed",
	),
	GenerationFailed: definition(
		"QUAKE.MEETING.GENERATION_FAILED",
		"Meeting summary generation failed",
	),
	StorageFailed: definition(
		"QUAKE.MEETING.STORAGE_FAILED",
		"Meeting history could not be saved",
	),
	ExportFailed: definition(
		"QUAKE.MEETING.EXPORT_FAILED",
		"Meeting export failed",
	),
	Unavailable: definition(
		"QUAKE.MEETING.UNAVAILABLE",
		"The configured meeting dependency is unavailable",
	),
	Invalid: definition(
		"QUAKE.MEETING.INVALID",
		"The meeting request is invalid",
	),
	Timeout: definition("QUAKE.MEETING.TIMEOUT", "Meeting processing timed out"),
} as const;

export class MeetingCaptureDenied extends Schema.TaggedError<MeetingCaptureDenied>()(
	"MeetingCaptureDenied",
	{
		code: Schema.Literal(MeetingErrors.CaptureDenied.code),
		message: Schema.Literal(MeetingErrors.CaptureDenied.message),
		category: Schema.Literal(MeetingErrors.CaptureDenied.category),
		diagnosticCause: DiagnosticCause,
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({
			code: MeetingErrors.CaptureDenied.code,
			message: MeetingErrors.CaptureDenied.message,
			category: MeetingErrors.CaptureDenied.category,
			diagnosticCause: toSafeDiagnosticCause(cause),
		});
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}

export class MeetingSourceLost extends Schema.TaggedError<MeetingSourceLost>()(
	"MeetingSourceLost",
	{
		code: Schema.Literal(MeetingErrors.SourceLost.code),
		message: Schema.Literal(MeetingErrors.SourceLost.message),
		category: Schema.Literal(MeetingErrors.SourceLost.category),
		diagnosticCause: DiagnosticCause,
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({
			code: MeetingErrors.SourceLost.code,
			message: MeetingErrors.SourceLost.message,
			category: MeetingErrors.SourceLost.category,
			diagnosticCause: toSafeDiagnosticCause(cause),
		});
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}

export class MeetingConverterUnavailable extends Schema.TaggedError<MeetingConverterUnavailable>()(
	"MeetingConverterUnavailable",
	{
		code: Schema.Literal(MeetingErrors.ConverterUnavailable.code),
		message: Schema.Literal(MeetingErrors.ConverterUnavailable.message),
		category: Schema.Literal(MeetingErrors.ConverterUnavailable.category),
		diagnosticCause: DiagnosticCause,
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({
			code: MeetingErrors.ConverterUnavailable.code,
			message: MeetingErrors.ConverterUnavailable.message,
			category: MeetingErrors.ConverterUnavailable.category,
			diagnosticCause: toSafeDiagnosticCause(cause),
		});
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}

export class MeetingCaptureFailed extends Schema.TaggedError<MeetingCaptureFailed>()(
	"MeetingCaptureFailed",
	{
		code: Schema.Literal(MeetingErrors.CaptureFailed.code),
		message: Schema.Literal(MeetingErrors.CaptureFailed.message),
		category: Schema.Literal(MeetingErrors.CaptureFailed.category),
		diagnosticCause: DiagnosticCause,
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({
			code: MeetingErrors.CaptureFailed.code,
			message: MeetingErrors.CaptureFailed.message,
			category: MeetingErrors.CaptureFailed.category,
			diagnosticCause: toSafeDiagnosticCause(cause),
		});
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}

export class MeetingTranscriptionFailed extends Schema.TaggedError<MeetingTranscriptionFailed>()(
	"MeetingTranscriptionFailed",
	{
		code: Schema.Literal(MeetingErrors.TranscriptionFailed.code),
		message: Schema.Literal(MeetingErrors.TranscriptionFailed.message),
		category: Schema.Literal(MeetingErrors.TranscriptionFailed.category),
		diagnosticCause: DiagnosticCause,
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({
			code: MeetingErrors.TranscriptionFailed.code,
			message: MeetingErrors.TranscriptionFailed.message,
			category: MeetingErrors.TranscriptionFailed.category,
			diagnosticCause: toSafeDiagnosticCause(cause),
		});
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}

export class MeetingGenerationFailed extends Schema.TaggedError<MeetingGenerationFailed>()(
	"MeetingGenerationFailed",
	{
		code: Schema.Literal(MeetingErrors.GenerationFailed.code),
		message: Schema.Literal(MeetingErrors.GenerationFailed.message),
		category: Schema.Literal(MeetingErrors.GenerationFailed.category),
		diagnosticCause: DiagnosticCause,
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({
			code: MeetingErrors.GenerationFailed.code,
			message: MeetingErrors.GenerationFailed.message,
			category: MeetingErrors.GenerationFailed.category,
			diagnosticCause: toSafeDiagnosticCause(cause),
		});
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}

export class MeetingStorageFailed extends Schema.TaggedError<MeetingStorageFailed>()(
	"MeetingStorageFailed",
	{
		code: Schema.Literal(MeetingErrors.StorageFailed.code),
		message: Schema.Literal(MeetingErrors.StorageFailed.message),
		category: Schema.Literal(MeetingErrors.StorageFailed.category),
		diagnosticCause: DiagnosticCause,
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({
			code: MeetingErrors.StorageFailed.code,
			message: MeetingErrors.StorageFailed.message,
			category: MeetingErrors.StorageFailed.category,
			diagnosticCause: toSafeDiagnosticCause(cause),
		});
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}

export class MeetingExportFailed extends Schema.TaggedError<MeetingExportFailed>()(
	"MeetingExportFailed",
	{
		code: Schema.Literal(MeetingErrors.ExportFailed.code),
		message: Schema.Literal(MeetingErrors.ExportFailed.message),
		category: Schema.Literal(MeetingErrors.ExportFailed.category),
		diagnosticCause: DiagnosticCause,
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({
			code: MeetingErrors.ExportFailed.code,
			message: MeetingErrors.ExportFailed.message,
			category: MeetingErrors.ExportFailed.category,
			diagnosticCause: toSafeDiagnosticCause(cause),
		});
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}

export class MeetingUnavailable extends Schema.TaggedError<MeetingUnavailable>()(
	"MeetingUnavailable",
	{
		code: Schema.Literal(MeetingErrors.Unavailable.code),
		message: Schema.Literal(MeetingErrors.Unavailable.message),
		category: Schema.Literal(MeetingErrors.Unavailable.category),
		diagnosticCause: DiagnosticCause,
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({
			code: MeetingErrors.Unavailable.code,
			message: MeetingErrors.Unavailable.message,
			category: MeetingErrors.Unavailable.category,
			diagnosticCause: toSafeDiagnosticCause(cause),
		});
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}

export class MeetingInvalid extends Schema.TaggedError<MeetingInvalid>()(
	"MeetingInvalid",
	{
		code: Schema.Literal(MeetingErrors.Invalid.code),
		message: Schema.Literal(MeetingErrors.Invalid.message),
		category: Schema.Literal(MeetingErrors.Invalid.category),
		diagnosticCause: DiagnosticCause,
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({
			code: MeetingErrors.Invalid.code,
			message: MeetingErrors.Invalid.message,
			category: MeetingErrors.Invalid.category,
			diagnosticCause: toSafeDiagnosticCause(cause),
		});
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}

export class MeetingTimeout extends Schema.TaggedError<MeetingTimeout>()(
	"MeetingTimeout",
	{
		code: Schema.Literal(MeetingErrors.Timeout.code),
		message: Schema.Literal(MeetingErrors.Timeout.message),
		category: Schema.Literal(MeetingErrors.Timeout.category),
		diagnosticCause: DiagnosticCause,
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({
			code: MeetingErrors.Timeout.code,
			message: MeetingErrors.Timeout.message,
			category: MeetingErrors.Timeout.category,
			diagnosticCause: toSafeDiagnosticCause(cause),
		});
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}

export type MeetingError =
	| MeetingConverterUnavailable
	| MeetingCaptureDenied
	| MeetingSourceLost
	| MeetingCaptureFailed
	| MeetingTranscriptionFailed
	| MeetingGenerationFailed
	| MeetingStorageFailed
	| MeetingExportFailed
	| MeetingUnavailable
	| MeetingInvalid
	| MeetingTimeout;
export const MeetingErrorSchema = Schema.Union(
	MeetingConverterUnavailable,
	MeetingCaptureDenied,
	MeetingSourceLost,
	MeetingCaptureFailed,
	MeetingTranscriptionFailed,
	MeetingGenerationFailed,
	MeetingStorageFailed,
	MeetingExportFailed,
	MeetingUnavailable,
	MeetingInvalid,
	MeetingTimeout,
);
export const isMeetingError = Schema.is(MeetingErrorSchema);
export function meetingError(
	reason: keyof typeof MeetingErrors,
	cause: unknown = undefined,
): MeetingError {
	switch (reason) {
		case "ConverterUnavailable":
			return new MeetingConverterUnavailable(cause);
		case "CaptureDenied":
			return new MeetingCaptureDenied(cause);
		case "SourceLost":
			return new MeetingSourceLost(cause);
		case "CaptureFailed":
			return new MeetingCaptureFailed(cause);
		case "TranscriptionFailed":
			return new MeetingTranscriptionFailed(cause);
		case "GenerationFailed":
			return new MeetingGenerationFailed(cause);
		case "StorageFailed":
			return new MeetingStorageFailed(cause);
		case "ExportFailed":
			return new MeetingExportFailed(cause);
		case "Unavailable":
			return new MeetingUnavailable(cause);
		case "Invalid":
			return new MeetingInvalid(cause);
		case "Timeout":
			return new MeetingTimeout(cause);
	}
}
