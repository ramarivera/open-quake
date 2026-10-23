import { Schema } from "effect";

const dependencyPolicy = {
	userFacing: false,
	userRecoverable: true,
	retry: "manual",
} as const;

/** Package-local catalog until the repo grows a shared error kernel. */
export const DeviceErrors = {
	DiscoveryFailed: {
		code: "QUAKE.HID.DISCOVERY_FAILED",
		category: "dependency",
		message: "Discovering HID devices failed",
		policy: dependencyPolicy,
	},
	DeviceNotFound: {
		code: "QUAKE.DEVICE.NOT_FOUND",
		category: "unavailable",
		message: "No matching QUAKE device found",
		policy: dependencyPolicy,
	},
	OpenFailed: {
		code: "QUAKE.HID.OPEN_FAILED",
		category: "dependency",
		message: "Opening the HID device failed",
		policy: dependencyPolicy,
	},
	ReadFailed: {
		code: "QUAKE.HID.READ_FAILED",
		category: "dependency",
		message: "Reading a HID report failed",
		policy: dependencyPolicy,
	},
	WriteFailed: {
		code: "QUAKE.HID.WRITE_FAILED",
		category: "dependency",
		message: "Writing a HID report failed",
		policy: dependencyPolicy,
	},
	CloseFailed: {
		code: "QUAKE.HID.CLOSE_FAILED",
		category: "dependency",
		message: "Closing the HID device failed",
		policy: dependencyPolicy,
	},
	ConfigInvalid: {
		code: "QUAKE.CONNECTION.CONFIG_INVALID",
		category: "validation",
		message: "The keep-alive interval must be positive and finite",
		policy: dependencyPolicy,
	},
	CallbackFailed: {
		code: "QUAKE.SUBSCRIPTION.CALLBACK_FAILED",
		category: "dependency",
		message: "A device subscription callback failed",
		policy: dependencyPolicy,
	},
	ConnectionClosed: {
		code: "QUAKE.CONNECTION.CLOSED",
		category: "unavailable",
		message: "The device client is closed",
		policy: dependencyPolicy,
	},
} as const;

export interface DiagnosticCause {
	readonly name: string;
	readonly sourceCode?: string;
	readonly cause?: DiagnosticCause;
	readonly truncated: boolean;
}

const DiagnosticCause: Schema.Schema<DiagnosticCause> = Schema.suspend(() =>
	Schema.Struct({
		name: Schema.String,
		sourceCode: Schema.optionalWith(Schema.String, { exact: true }),
		cause: Schema.optionalWith(DiagnosticCause, { exact: true }),
		truncated: Schema.Boolean,
	}),
);

/** No upstream messages, paths, arbitrary fields, or user strings serialize. */
export function toSafeDiagnosticCause(
	input: unknown,
	depth = 0,
): DiagnosticCause {
	if (depth >= 4) return { name: "TruncatedCause", truncated: true };
	try {
		if (!(input instanceof Error))
			return { name: "UnknownCause", truncated: true };
		const code = "code" in input ? input.code : undefined;
		const sourceCode =
			typeof code === "string" &&
			["EACCES", "EPERM", "EIO", "ENODEV", "ENOENT", "EBUSY"].includes(code)
				? code
				: undefined;
		return {
			name:
				input instanceof TypeError
					? "TypeError"
					: input instanceof RangeError
						? "RangeError"
						: "Error",
			...(sourceCode ? { sourceCode } : {}),
			...(input.cause === undefined
				? {}
				: { cause: toSafeDiagnosticCause(input.cause, depth + 1) }),
			truncated: true,
		};
	} catch {
		return { name: "UnreadableCause", truncated: true };
	}
}

type Entry = (typeof DeviceErrors)[keyof typeof DeviceErrors];
const fields = <const E extends Entry>(entry: E) => ({
	code: Schema.Literal(entry.code),
	category: Schema.Literal(entry.category),
	message: Schema.Literal(entry.message),
	diagnosticCause: DiagnosticCause,
});
const props = <const E extends Entry>(entry: E, cause: unknown) => ({
	code: entry.code,
	category: entry.category,
	message: entry.message,
	diagnosticCause: toSafeDiagnosticCause(cause),
});
const retain = (error: object, cause: unknown): void => {
	Object.defineProperty(error, "originalCause", {
		value: cause,
		enumerable: false,
	});
};

export class QuakeHidDiscoveryFailed extends Schema.TaggedError<QuakeHidDiscoveryFailed>()(
	"QuakeHidDiscoveryFailed",
	fields(DeviceErrors.DiscoveryFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(DeviceErrors.DiscoveryFailed, cause));
		retain(this, cause);
	}
}
export class QuakeDeviceNotFound extends Schema.TaggedError<QuakeDeviceNotFound>()(
	"QuakeDeviceNotFound",
	fields(DeviceErrors.DeviceNotFound),
) {
	constructor() {
		super(props(DeviceErrors.DeviceNotFound, undefined));
	}
}
export class QuakeHidOpenFailed extends Schema.TaggedError<QuakeHidOpenFailed>()(
	"QuakeHidOpenFailed",
	fields(DeviceErrors.OpenFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(DeviceErrors.OpenFailed, cause));
		retain(this, cause);
	}
}
export class QuakeHidReadFailed extends Schema.TaggedError<QuakeHidReadFailed>()(
	"QuakeHidReadFailed",
	fields(DeviceErrors.ReadFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(DeviceErrors.ReadFailed, cause));
		retain(this, cause);
	}
}
export class QuakeHidWriteFailed extends Schema.TaggedError<QuakeHidWriteFailed>()(
	"QuakeHidWriteFailed",
	fields(DeviceErrors.WriteFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(DeviceErrors.WriteFailed, cause));
		retain(this, cause);
	}
}
export class QuakeHidCloseFailed extends Schema.TaggedError<QuakeHidCloseFailed>()(
	"QuakeHidCloseFailed",
	fields(DeviceErrors.CloseFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(DeviceErrors.CloseFailed, cause));
		retain(this, cause);
	}
}
export class QuakeConnectionConfigInvalid extends Schema.TaggedError<QuakeConnectionConfigInvalid>()(
	"QuakeConnectionConfigInvalid",
	fields(DeviceErrors.ConfigInvalid),
) {
	constructor() {
		super(props(DeviceErrors.ConfigInvalid, undefined));
	}
}
export class QuakeCallbackFailed extends Schema.TaggedError<QuakeCallbackFailed>()(
	"QuakeCallbackFailed",
	fields(DeviceErrors.CallbackFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(DeviceErrors.CallbackFailed, cause));
		retain(this, cause);
	}
}
export class QuakeConnectionClosed extends Schema.TaggedError<QuakeConnectionClosed>()(
	"QuakeConnectionClosed",
	fields(DeviceErrors.ConnectionClosed),
) {
	constructor() {
		super(props(DeviceErrors.ConnectionClosed, undefined));
	}
}
