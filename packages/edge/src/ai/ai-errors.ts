import { Schema } from "effect";
import { Capability } from "./ai-contracts.js";

const entry = <
	const Code extends string,
	const Category extends string,
	const Message extends string,
>(
	code: Code,
	category: Category,
	message: Message,
) => ({
	code,
	category,
	message,
	policy: { userFacing: true, userRecoverable: true, retry: "manual" as const },
});
/** AI-owned catalog until the repository has a shared error kernel. */
export const AiErrors = {
	ConfigInvalid: entry(
		"AI.PROVIDER.CONFIG_INVALID",
		"validation",
		"The provider configuration is invalid",
	),
	AuthRequired: entry(
		"AI.PROVIDER.AUTH_REQUIRED",
		"authentication",
		"Provider credentials are required",
	),
	AuthRevoked: entry(
		"AI.PROVIDER.AUTH_REVOKED",
		"authentication",
		"Provider credentials were revoked",
	),
	CapabilityUnsupported: entry(
		"AI.PROVIDER.CAPABILITY_UNSUPPORTED",
		"validation",
		"The provider capability is unsupported",
	),
	RateLimited: entry(
		"AI.PROVIDER.RATE_LIMITED",
		"dependency",
		"The provider rate limit was reached",
	),
	Unavailable: entry(
		"AI.PROVIDER.UNAVAILABLE",
		"unavailable",
		"The provider is unavailable",
	),
	ProtocolInvalid: entry(
		"AI.PROVIDER.PROTOCOL_INVALID",
		"dependency",
		"The provider stream is invalid",
	),
	CredentialStoreFailed: entry(
		"AI.CREDENTIAL.STORE_FAILED",
		"dependency",
		"The secure credential store failed",
	),
} as const;
export interface DiagnosticCause {
	readonly name:
		| "Error"
		| "TypeError"
		| "RangeError"
		| "UnknownCause"
		| "TruncatedCause";
	readonly sourceCode?: "EACCES" | "EPERM" | "EIO" | "ENOENT";
	readonly cause?: DiagnosticCause;
	readonly truncated: true;
}
const DiagnosticCause: Schema.Schema<DiagnosticCause> = Schema.suspend(() =>
	Schema.Struct({
		name: Schema.Literal(
			"Error",
			"TypeError",
			"RangeError",
			"UnknownCause",
			"TruncatedCause",
		),
		sourceCode: Schema.optionalWith(
			Schema.Literal("EACCES", "EPERM", "EIO", "ENOENT"),
			{ exact: true },
		),
		cause: Schema.optionalWith(DiagnosticCause, { exact: true }),
		truncated: Schema.Literal(true),
	}),
);
/** Never projects messages, URLs, names supplied by a provider, or arbitrary codes. */
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
			code === "EACCES" ||
			code === "EPERM" ||
			code === "EIO" ||
			code === "ENOENT"
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
		return { name: "UnknownCause", truncated: true };
	}
}
type Entry = (typeof AiErrors)[keyof typeof AiErrors];
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

export class AiConfigInvalid extends Schema.TaggedError<AiConfigInvalid>()(
	"AiConfigInvalid",
	fields(AiErrors.ConfigInvalid),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AiErrors.ConfigInvalid, cause));
		retain(this, cause);
	}
}

export class AiAuthRequired extends Schema.TaggedError<AiAuthRequired>()(
	"AiAuthRequired",
	fields(AiErrors.AuthRequired),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AiErrors.AuthRequired, cause));
		retain(this, cause);
	}
}

export class AiAuthRevoked extends Schema.TaggedError<AiAuthRevoked>()(
	"AiAuthRevoked",
	fields(AiErrors.AuthRevoked),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AiErrors.AuthRevoked, cause));
		retain(this, cause);
	}
}

export class AiCapabilityUnsupported extends Schema.TaggedError<AiCapabilityUnsupported>()(
	"AiCapabilityUnsupported",
	{ ...fields(AiErrors.CapabilityUnsupported), capability: Capability },
) {
	declare readonly originalCause: unknown;
	constructor(capability: typeof Capability.Type, cause: unknown = undefined) {
		super({ ...props(AiErrors.CapabilityUnsupported, cause), capability });
		retain(this, cause);
	}
}

export class AiRateLimited extends Schema.TaggedError<AiRateLimited>()(
	"AiRateLimited",
	fields(AiErrors.RateLimited),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AiErrors.RateLimited, cause));
		retain(this, cause);
	}
}

export class AiUnavailable extends Schema.TaggedError<AiUnavailable>()(
	"AiUnavailable",
	fields(AiErrors.Unavailable),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AiErrors.Unavailable, cause));
		retain(this, cause);
	}
}

export class AiProtocolInvalid extends Schema.TaggedError<AiProtocolInvalid>()(
	"AiProtocolInvalid",
	fields(AiErrors.ProtocolInvalid),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AiErrors.ProtocolInvalid, cause));
		retain(this, cause);
	}
}

export class AiCredentialStoreFailed extends Schema.TaggedError<AiCredentialStoreFailed>()(
	"AiCredentialStoreFailed",
	fields(AiErrors.CredentialStoreFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AiErrors.CredentialStoreFailed, cause));
		retain(this, cause);
	}
}

export type AiError =
	| AiConfigInvalid
	| AiAuthRequired
	| AiAuthRevoked
	| AiCapabilityUnsupported
	| AiRateLimited
	| AiUnavailable
	| AiProtocolInvalid
	| AiCredentialStoreFailed;

/** SDK adapters extract a numeric status at the SDK boundary, never branch on messages. */
export function translateProviderFailure(
	status: number | undefined,
	cause: unknown,
): AiError {
	switch (status) {
		case 401:
		case 403:
			return new AiAuthRequired(cause);
		case 429:
			return new AiRateLimited(cause);
		default:
			return new AiUnavailable(cause);
	}
}
