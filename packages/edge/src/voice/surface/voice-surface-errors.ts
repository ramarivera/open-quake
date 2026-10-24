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
