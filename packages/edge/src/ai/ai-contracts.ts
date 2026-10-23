import * as Schema from "effect/Schema";

export const ProfileId = Schema.UUID.pipe(Schema.brand("AiProfileId"));
export type ProfileId = typeof ProfileId.Type;
export const CredentialRef = Schema.UUID.pipe(Schema.brand("AiCredentialRef"));
export type CredentialRef = typeof CredentialRef.Type;
export const Capability = Schema.Literal(
	"text",
	"tools",
	"images",
	"imageGeneration",
	"videoGeneration",
	"stt",
	"tts",
);
export type Capability = typeof Capability.Type;
export const CapabilityStatus = Schema.Literal(
	"supported",
	"unsupported",
	"unverified",
);
export const Capabilities = Schema.Struct({
	text: CapabilityStatus,
	tools: CapabilityStatus,
	images: CapabilityStatus,
	imageGeneration: CapabilityStatus,
	videoGeneration: CapabilityStatus,
	stt: CapabilityStatus,
	tts: CapabilityStatus,
});
/** The deterministic mock implements text only; profiles cannot enable modalities. */
export const MOCK_CAPABILITIES = Object.freeze({
	text: "supported",
	tools: "unsupported",
	images: "unsupported",
	imageGeneration: "unsupported",
	videoGeneration: "unsupported",
	stt: "unsupported",
	tts: "unsupported",
} satisfies typeof Capabilities.Type);
const Finite = Schema.Number.pipe(Schema.finite());
const Count = Schema.Int.pipe(Schema.nonNegative());
const Range = Schema.Struct({ min: Finite, max: Finite });
export const Sampling = Schema.Struct({
	temperature: Schema.optional(Finite),
	topP: Schema.optional(Finite),
	maxOutputTokens: Schema.optional(Schema.Int.pipe(Schema.positive())),
});
export const ProviderProfile = Schema.Struct({
	version: Schema.Literal(1),
	id: ProfileId,
	adapter: Schema.Literal("mock", "openai-compatible", "codex"),
	baseUrl: Schema.NonEmptyTrimmedString,
	endpointPolicy: Schema.Literal("remote", "loopback"),
	modelId: Schema.NonEmptyTrimmedString,
	auth: Schema.Literal("none", "apiKey", "codexDevice"),
	credentialRef: Schema.optional(CredentialRef),
	authGeneration: Count,
	capabilities: Capabilities,
	sampling: Sampling,
	samplingLimits: Schema.Struct({
		temperature: Schema.optional(Range),
		topP: Schema.optional(Range),
		maxOutputTokens: Schema.optional(Schema.Int.pipe(Schema.positive())),
	}),
});
export type ProviderProfile = typeof ProviderProfile.Type;
/** Deliberate allowlist: no credential reference, auth generation, or endpoint. */
export const ProfileSummary = Schema.Struct({
	id: ProfileId,
	adapter: ProviderProfile.fields.adapter,
	modelId: Schema.String,
	auth: ProviderProfile.fields.auth,
	capabilities: Capabilities,
});
export type ProfileSummary = typeof ProfileSummary.Type;
export const InferenceRequest = Schema.Struct({
	profileId: ProfileId,
	messages: Schema.Array(
		Schema.Struct({
			role: Schema.Literal("system", "user", "assistant"),
			content: Schema.Array(
				Schema.Union(
					Schema.TaggedStruct("text", { text: Schema.String }),
					Schema.TaggedStruct("image", { url: Schema.String }),
				),
			),
		}),
	).pipe(Schema.minItems(1)),
	requestedCapabilities: Schema.Array(Capability),
	sampling: Sampling,
});
export type InferenceRequest = typeof InferenceRequest.Type;
export const Usage = Schema.Struct({
	inputTokens: Count,
	outputTokens: Count,
	provenance: Schema.Literal("reported", "estimated"),
});
export type Usage = typeof Usage.Type;
/** Failures use the typed stream error channel; completion is emitted once. */
export const NormalizedEvent = Schema.Union(
	Schema.TaggedStruct("textDelta", {
		textDelta: Schema.String,
		kind: Schema.Literal("generation"),
	}),
	Schema.TaggedStruct("suggestion", {
		suggestionId: Schema.NonEmptyString,
		text: Schema.String,
	}),
	Schema.TaggedStruct("usage", { usage: Usage }),
	Schema.TaggedStruct("completed", {}),
);
export type NormalizedEvent = typeof NormalizedEvent.Type;
