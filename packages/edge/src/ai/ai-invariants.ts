import { Either, Option, Schema } from "effect";
import {
	Capability,
	InferenceRequest,
	MOCK_CAPABILITIES,
	type ProfileSummary,
	ProviderProfile,
} from "./ai-contracts.js";

export type ValidationIssue =
	| { readonly reason: "config" }
	| { readonly reason: "capability"; readonly capability: Capability };

const endpoint = (input: string): Option.Option<URL> =>
	Either.getRight(Either.try(() => new URL(input)));

export function validEndpoint(
	baseUrl: string,
	policy: "remote" | "loopback",
): boolean {
	const parsed = endpoint(baseUrl);
	if (Option.isNone(parsed)) return false;
	const url = parsed.value;
	if (url.username || url.password || url.search || url.hash) return false;
	const loopback =
		url.hostname === "localhost" ||
		url.hostname === "[::1]" ||
		/^127\.[0-9]+\.[0-9]+\.[0-9]+$/.test(url.hostname);
	return policy === "loopback"
		? loopback && (url.protocol === "https:" || url.protocol === "http:")
		: url.protocol === "https:";
}

/** Adapters must use manual redirects and check this before forwarding credentials. */
export function credentialRedirectAllowed(
	from: string,
	to: string,
	policy: "remote" | "loopback",
): boolean {
	if (!validEndpoint(from, policy) || !validEndpoint(to, policy)) return false;
	const source = endpoint(from);
	const destination = endpoint(to);
	return (
		Option.isSome(source) &&
		Option.isSome(destination) &&
		source.value.origin === destination.value.origin
	);
}

export function profileSummary(profile: ProviderProfile): ProfileSummary {
	return {
		id: profile.id,
		adapter: profile.adapter,
		modelId: profile.modelId,
		auth: profile.auth,
		capabilities: profile.capabilities,
		...(profile.provider === undefined ? {} : { provider: profile.provider }),
		...(profile.models === undefined ? {} : { models: profile.models }),
		...(profile.controls === undefined ? {} : { controls: profile.controls }),
	};
}

export function validateProfile(
	input: unknown,
): Either.Either<ProviderProfile, ValidationIssue> {
	const decoded = Schema.decodeUnknownEither(ProviderProfile, {
		onExcessProperty: "error",
	})(input);
	if (Either.isLeft(decoded)) return Either.left({ reason: "config" });
	const profile = decoded.right;
	if (!validEndpoint(profile.baseUrl, profile.endpointPolicy))
		return Either.left({ reason: "config" });
	if (
		(profile.adapter === "mock" &&
			(profile.auth !== "none" || profile.credentialRef !== undefined)) ||
		(profile.adapter === "openai-compatible" && profile.auth !== "apiKey") ||
		(profile.adapter === "codex" &&
			(profile.auth !== "codexDevice" || profile.credentialRef !== undefined))
	)
		return Either.left({ reason: "config" });
	for (const key of ["temperature", "topP"] as const) {
		const range = profile.samplingLimits[key];
		if (
			range &&
			(range.min > range.max ||
				(key === "topP" && (range.min < 0 || range.max > 1)))
		)
			return Either.left({ reason: "config" });
	}
	if (!validSampling(profile.sampling, profile))
		return Either.left({ reason: "config" });
	if (
		profile.adapter === "mock" &&
		Capability.literals.some(
			(capability) =>
				profile.capabilities[capability] !== MOCK_CAPABILITIES[capability],
		)
	)
		return Either.left({ reason: "config" });
	return Either.right(profile);
}

function validSampling(
	sampling: InferenceRequest["sampling"],
	profile: ProviderProfile,
): boolean {
	for (const key of ["temperature", "topP"] as const) {
		const value = sampling[key];
		const range = profile.samplingLimits[key];
		if (
			value !== undefined &&
			(!Number.isFinite(value) ||
				!range ||
				value < range.min ||
				value > range.max)
		)
			return false;
	}
	const tokens = sampling.maxOutputTokens;
	const limit = profile.samplingLimits.maxOutputTokens;
	return (
		tokens === undefined ||
		(limit !== undefined &&
			Number.isInteger(tokens) &&
			tokens > 0 &&
			tokens <= limit)
	);
}

export function validateRequest(
	profile: ProviderProfile,
	input: unknown,
): Either.Either<InferenceRequest, ValidationIssue> {
	const decoded = Schema.decodeUnknownEither(InferenceRequest, {
		onExcessProperty: "error",
	})(input);
	if (Either.isLeft(decoded)) return Either.left({ reason: "config" });
	const request = decoded.right;
	if (
		request.profileId !== profile.id ||
		!validSampling({ ...profile.sampling, ...request.sampling }, profile)
	)
		return Either.left({ reason: "config" });
	const capabilities: ReadonlyArray<Capability> = [
		"text",
		...(request.modelRole === "vision"
			? ["images" as const]
			: request.modelRole === "image"
				? ["imageGeneration" as const]
				: request.modelRole === "video"
					? ["videoGeneration" as const]
					: request.modelRole === "tts"
						? ["tts" as const]
						: []),
		...request.requestedCapabilities,
		...(request.messages.some((message) =>
			message.content.some((part) => part._tag === "image"),
		)
			? ["images" as const]
			: []),
	];
	for (const capability of capabilities) {
		if (
			profile.capabilities[capability] !== "supported" ||
			(profile.adapter === "mock" &&
				MOCK_CAPABILITIES[capability] !== "supported")
		)
			return Either.left({ reason: "capability", capability });
	}
	return Either.right({
		...request,
		sampling: { ...profile.sampling, ...request.sampling },
	});
}
