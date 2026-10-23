import { Schema } from "effect";

const policy = {
	userFacing: false,
	userRecoverable: true,
	retry: "never",
} as const;
const entry = <const Code extends string, const Message extends string>(
	code: Code,
	message: Message,
) => ({ code, category: "validation", message, policy }) as const;

/** Protocol-owned catalog, exported for composition by the device boundary. */
export const ProtocolErrors = {
	ProtocolInputInvalid: entry(
		"QUAKE.PROTOCOL.INPUT_INVALID",
		"Protocol input is invalid",
	),
	FrameSizeInvalid: entry(
		"QUAKE.PROTOCOL.FRAME_SIZE_INVALID",
		"Protocol frame size is invalid",
	),
	FrameChecksumMismatch: entry(
		"QUAKE.PROTOCOL.CHECKSUM_MISMATCH",
		"Protocol frame checksum does not match",
	),
	FrameTypeUnsupported: entry(
		"QUAKE.PROTOCOL.TYPE_UNSUPPORTED",
		"Protocol frame type is unsupported",
	),
	ProtocolJsonInvalid: entry(
		"QUAKE.PROTOCOL.JSON_INVALID",
		"Protocol JSON is invalid",
	),
	QmkResponseMismatch: entry(
		"QUAKE.QMK.RESPONSE_MISMATCH",
		"QMK response does not match its request",
	),
} as const;

const fields = <const Code extends string, const Message extends string>(def: {
	code: Code;
	message: Message;
	category: "validation";
}) => ({
	code: Schema.Literal(def.code),
	category: Schema.Literal(def.category),
	message: Schema.Literal(def.message),
});

// Fixed allowlisted diagnostics deliberately omit parser messages and input bytes.
const DiagnosticCause = Schema.Struct({
	name: Schema.Literal("ProtocolValidation"),
});
const retain = (target: object, cause: unknown): void => {
	Object.defineProperty(target, "originalCause", {
		value: cause,
		enumerable: false,
	});
};

export class ProtocolInputInvalid extends Schema.TaggedError<ProtocolInputInvalid>()(
	"ProtocolInputInvalid",
	{
		...fields(ProtocolErrors.ProtocolInputInvalid),
		diagnosticCause: DiagnosticCause,
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super({
			...ProtocolErrors.ProtocolInputInvalid,
			diagnosticCause: { name: "ProtocolValidation" },
		});
		retain(this, cause);
	}
}

export class ProtocolJsonInvalid extends Schema.TaggedError<ProtocolJsonInvalid>()(
	"ProtocolJsonInvalid",
	{
		...fields(ProtocolErrors.ProtocolJsonInvalid),
		diagnosticCause: DiagnosticCause,
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super({
			...ProtocolErrors.ProtocolJsonInvalid,
			diagnosticCause: { name: "ProtocolValidation" },
		});
		retain(this, cause);
	}
}

export class FrameSizeInvalid extends Schema.TaggedError<FrameSizeInvalid>()(
	"FrameSizeInvalid",
	{
		...fields(ProtocolErrors.FrameSizeInvalid),
		actual: Schema.Number,
		minimum: Schema.Number,
		maximum: Schema.Number,
	},
) {
	constructor(actual: number, minimum: number, maximum = minimum) {
		super({ ...ProtocolErrors.FrameSizeInvalid, actual, minimum, maximum });
	}
}

export class FrameChecksumMismatch extends Schema.TaggedError<FrameChecksumMismatch>()(
	"FrameChecksumMismatch",
	fields(ProtocolErrors.FrameChecksumMismatch),
) {
	constructor() {
		super(ProtocolErrors.FrameChecksumMismatch);
	}
}

export class FrameTypeUnsupported extends Schema.TaggedError<FrameTypeUnsupported>()(
	"FrameTypeUnsupported",
	fields(ProtocolErrors.FrameTypeUnsupported),
) {
	constructor() {
		super(ProtocolErrors.FrameTypeUnsupported);
	}
}

export class QmkResponseMismatch extends Schema.TaggedError<QmkResponseMismatch>()(
	"QmkResponseMismatch",
	fields(ProtocolErrors.QmkResponseMismatch),
) {
	constructor() {
		super(ProtocolErrors.QmkResponseMismatch);
	}
}

export type ProtocolError =
	| ProtocolInputInvalid
	| FrameSizeInvalid
	| FrameChecksumMismatch
	| FrameTypeUnsupported
	| ProtocolJsonInvalid
	| QmkResponseMismatch;
