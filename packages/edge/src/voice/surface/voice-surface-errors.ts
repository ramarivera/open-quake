import { Schema } from "effect";
import { DiagnosticCause, toSafeDiagnosticCause } from "../../ai/ai-errors.js";

/** Voice surface catalog (open-quake-errors); consumers branch on `_tag`/`code`. */
export const VoiceSurfaceErrors = {
	RuntimeUnavailable: {
		code: "VOICE.GRID.RUNTIME_UNAVAILABLE",
		category: "unavailable",
		message: "No voice runtime is available for this key",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	RequestInvalid: {
		code: "VOICE.SURFACE.REQUEST_INVALID",
		category: "validation",
		message: "The voice surface request is invalid",
		policy: { userFacing: false, userRecoverable: false, retry: "never" },
	},
	RequestFailed: {
		code: "VOICE.SURFACE.REQUEST_FAILED",
		category: "dependency",
		message: "The voice surface request could not be delivered",
		policy: { userFacing: false, userRecoverable: true, retry: "manual" },
	},
	LinkRejected: {
		code: "VOICE.SURFACE.LINK_REJECTED",
		category: "validation",
		message: "Only http and https links without credentials can be opened",
		policy: { userFacing: true, userRecoverable: false, retry: "never" },
	},
} as const;

type Entry = (typeof VoiceSurfaceErrors)[keyof typeof VoiceSurfaceErrors];
const fields = <const E extends Entry>(def: E) => ({
	code: Schema.Literal(def.code),
	category: Schema.Literal(def.category),
	message: Schema.Literal(def.message),
	diagnosticCause: DiagnosticCause,
});
const props = <const E extends Entry>(def: E, cause: unknown) => ({
	code: def.code,
	category: def.category,
	message: def.message,
	diagnosticCause: toSafeDiagnosticCause(cause),
});
const retain = (target: object, cause: unknown): void => {
	Object.defineProperty(target, "originalCause", {
		value: cause,
		enumerable: false,
	});
};

export class VoiceRuntimeUnavailable extends Schema.TaggedError<VoiceRuntimeUnavailable>()(
	"VoiceRuntimeUnavailable",
	fields(VoiceSurfaceErrors.RuntimeUnavailable),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(VoiceSurfaceErrors.RuntimeUnavailable, cause));
		retain(this, cause);
	}
}

export class VoiceSurfaceRequestInvalid extends Schema.TaggedError<VoiceSurfaceRequestInvalid>()(
	"VoiceSurfaceRequestInvalid",
	fields(VoiceSurfaceErrors.RequestInvalid),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(VoiceSurfaceErrors.RequestInvalid, cause));
		retain(this, cause);
	}
}

export class VoiceSurfaceRequestFailed extends Schema.TaggedError<VoiceSurfaceRequestFailed>()(
	"VoiceSurfaceRequestFailed",
	fields(VoiceSurfaceErrors.RequestFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(VoiceSurfaceErrors.RequestFailed, cause));
		retain(this, cause);
	}
}

export class VoiceLinkRejected extends Schema.TaggedError<VoiceLinkRejected>()(
	"VoiceLinkRejected",
	fields(VoiceSurfaceErrors.LinkRejected),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(VoiceSurfaceErrors.LinkRejected, cause));
		retain(this, cause);
	}
}

export const VoiceKnobErrors = {
	Busy: {
		code: "VOICE.KNOB.BUSY",
		category: "unavailable",
		message: "Another voice capture or cleanup owns the microphone",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	RouteIncomplete: {
		code: "VOICE.KNOB.ROUTE_INCOMPLETE",
		category: "validation",
		message: "Choose a saved provider profile and model for this knob",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	RouteUnavailable: {
		code: "VOICE.KNOB.ROUTE_UNAVAILABLE",
		category: "unavailable",
		message: "This knob voice route is unavailable",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
} as const;
export class VoiceKnobRejected extends Schema.TaggedError<VoiceKnobRejected>()(
	"VoiceKnobRejected",
	{
		code: Schema.Literal(
			"VOICE.KNOB.BUSY",
			"VOICE.KNOB.ROUTE_INCOMPLETE",
			"VOICE.KNOB.ROUTE_UNAVAILABLE",
		),
		category: Schema.Literal("validation", "unavailable"),
		message: Schema.String,
		diagnosticCause: DiagnosticCause,
	},
) {
	declare readonly originalCause: unknown;
	constructor(kind: keyof typeof VoiceKnobErrors, cause: unknown = undefined) {
		const definition = VoiceKnobErrors[kind];
		super({
			code: definition.code,
			category: definition.category,
			message: definition.message,
			diagnosticCause: toSafeDiagnosticCause(cause),
		});
		retain(this, cause);
	}
}
