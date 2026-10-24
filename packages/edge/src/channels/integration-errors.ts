import { Schema } from "effect";
import { toSafeDiagnosticCause } from "../ai/ai-errors.js";

const entry = <const C extends string, const M extends string>(
	code: C,
	message: M,
) => ({
	code,
	message,
	category: "dependency",
	policy: { userFacing: true, userRecoverable: true, retry: "manual" },
});
export const IntegrationErrors = {
	InputRejected: entry("INTEGRATION.INPUT.REJECTED", "Invalid configuration"),
	StoreFailed: entry("INTEGRATION.STORE.FAILED", "Integration storage failed"),
	CredentialFailed: entry(
		"INTEGRATION.CREDENTIAL.FAILED",
		"The secure credential store failed",
	),
	RuntimeUnavailable: entry(
		"INTEGRATION.RUNTIME.UNAVAILABLE",
		"OpenClaw runtime is unavailable",
	),
	DraftUnavailable: entry("INTEGRATION.DRAFT.UNAVAILABLE", "AI is unavailable"),
	HaNetworkFailed: entry(
		"HA.NETWORK.FAILED",
		"Home Assistant network request failed",
	),
	HaAuthenticationFailed: entry(
		"HA.AUTH.FAILED",
		"Home Assistant authentication failed",
	),
	HaCertificateRejected: entry(
		"HA.CERTIFICATE.REJECTED",
		"Home Assistant certificate requires consent",
	),
	ProfilePlacementFailed: entry(
		"INTEGRATION.PROFILE.FAILED",
		"Profile placement failed",
	),
} as const;
const retain = (target: object, cause: unknown) =>
	Object.defineProperty(target, "originalCause", {
		value: cause,
		enumerable: false,
	});
const fields = <
	const E extends (typeof IntegrationErrors)[keyof typeof IntegrationErrors],
>(
	e: E,
) => ({
	code: Schema.Literal(e.code),
	message: Schema.Literal(e.message),
	category: Schema.Literal(e.category),
	diagnosticCause: Schema.Unknown,
});
const props = <
	const E extends (typeof IntegrationErrors)[keyof typeof IntegrationErrors],
>(
	e: E,
	cause: unknown,
) => ({
	code: e.code,
	message: e.message,
	category: e.category,
	diagnosticCause: toSafeDiagnosticCause(cause),
});

export class InputRejected extends Schema.TaggedError<InputRejected>()(
	"InputRejected",
	{ ...fields(IntegrationErrors.InputRejected), field: Schema.String },
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined, field = "configuration") {
		super({ ...props(IntegrationErrors.InputRejected, cause), field });
		retain(this, cause);
	}
}

export class StoreFailed extends Schema.TaggedError<StoreFailed>()(
	"StoreFailed",
	{ ...fields(IntegrationErrors.StoreFailed) },
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({ ...props(IntegrationErrors.StoreFailed, cause) });
		retain(this, cause);
	}
}

export class CredentialFailed extends Schema.TaggedError<CredentialFailed>()(
	"CredentialFailed",
	{ ...fields(IntegrationErrors.CredentialFailed) },
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({ ...props(IntegrationErrors.CredentialFailed, cause) });
		retain(this, cause);
	}
}

export class RuntimeUnavailable extends Schema.TaggedError<RuntimeUnavailable>()(
	"RuntimeUnavailable",
	{ ...fields(IntegrationErrors.RuntimeUnavailable) },
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({ ...props(IntegrationErrors.RuntimeUnavailable, cause) });
		retain(this, cause);
	}
}

export class DraftUnavailable extends Schema.TaggedError<DraftUnavailable>()(
	"DraftUnavailable",
	{ ...fields(IntegrationErrors.DraftUnavailable) },
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({ ...props(IntegrationErrors.DraftUnavailable, cause) });
		retain(this, cause);
	}
}

export class HaNetworkFailed extends Schema.TaggedError<HaNetworkFailed>()(
	"HaNetworkFailed",
	{ ...fields(IntegrationErrors.HaNetworkFailed) },
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({ ...props(IntegrationErrors.HaNetworkFailed, cause) });
		retain(this, cause);
	}
}

export class HaAuthenticationFailed extends Schema.TaggedError<HaAuthenticationFailed>()(
	"HaAuthenticationFailed",
	{ ...fields(IntegrationErrors.HaAuthenticationFailed) },
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({ ...props(IntegrationErrors.HaAuthenticationFailed, cause) });
		retain(this, cause);
	}
}

export class HaCertificateRejected extends Schema.TaggedError<HaCertificateRejected>()(
	"HaCertificateRejected",
	{
		...fields(IntegrationErrors.HaCertificateRejected),
		origin: Schema.String,
		fingerprint: Schema.String,
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined, origin = "", fingerprint = "") {
		super({
			...props(IntegrationErrors.HaCertificateRejected, cause),
			origin,
			fingerprint,
		});
		retain(this, cause);
	}
}

export class ProfilePlacementFailed extends Schema.TaggedError<ProfilePlacementFailed>()(
	"ProfilePlacementFailed",
	{ ...fields(IntegrationErrors.ProfilePlacementFailed) },
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super({ ...props(IntegrationErrors.ProfilePlacementFailed, cause) });
		retain(this, cause);
	}
}

export type IntegrationError =
	| InputRejected
	| StoreFailed
	| CredentialFailed
	| RuntimeUnavailable
	| DraftUnavailable
	| HaNetworkFailed
	| HaAuthenticationFailed
	| HaCertificateRejected
	| ProfilePlacementFailed;
