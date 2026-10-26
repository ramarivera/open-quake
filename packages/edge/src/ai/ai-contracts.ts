import * as Schema from "effect/Schema";
import {
	GenerationControls,
	ModelRole,
	ModelRoles,
	ProviderKind,
	RoleSelection,
} from "./ai-workflow-contracts.js";

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
export const ProviderSettings = Schema.Struct({
	mediaKind: Schema.optional(Schema.Literal("image", "video")),
	botId: Schema.optional(
		Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(256)),
	),
	entryMethod: Schema.optional(Schema.Literal("inference", "agent")),
	filesEnabled: Schema.optional(Schema.Boolean),
});
export const ProviderProfile = Schema.Struct({
	version: Schema.Literal(1),
	id: ProfileId,
	adapter: Schema.Literal(
		"mock",
		"openai-compatible",
		"codex",
		"coze",
		"xfy",
		"dashscope-media",
	),
	baseUrl: Schema.NonEmptyTrimmedString,
	endpointPolicy: Schema.Literal("remote", "loopback"),
	modelId: Schema.NonEmptyTrimmedString,
	provider: Schema.optional(ProviderKind),
	settings: Schema.optional(ProviderSettings),
	models: Schema.optional(ModelRoles),
	controls: Schema.optional(GenerationControls),
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
	provider: ProviderProfile.fields.provider,
	models: ProviderProfile.fields.models,
	controls: ProviderProfile.fields.controls,
});
export type ProfileSummary = typeof ProfileSummary.Type;
export const ToolCall = Schema.Struct({
	id: Schema.NonEmptyString.pipe(Schema.maxLength(256)),
	name: Schema.NonEmptyString.pipe(Schema.pattern(/^[a-zA-Z0-9_-]{1,64}$/)),
	arguments: Schema.String.pipe(Schema.maxLength(32768)),
});
export const ToolDefinition = Schema.Struct({
	name: ToolCall.fields.name,
	description: Schema.String.pipe(Schema.maxLength(4096)),
	properties: Schema.Record({
		key: Schema.String,
		value: Schema.Struct({
			type: Schema.Literal("string", "number", "boolean"),
			description: Schema.optional(Schema.String),
		}),
	}),
	required: Schema.Array(Schema.String),
});
export const InferenceRequest = Schema.Struct({
	profileId: ProfileId,
	modelRole: Schema.optional(ModelRole),
	persona: Schema.optional(RoleSelection),
	tools: Schema.optional(
		Schema.Array(ToolDefinition).pipe(Schema.maxItems(16)),
	),
	controls: Schema.optional(GenerationControls),
	messages: Schema.Array(
		Schema.Struct({
			role: Schema.Literal("system", "user", "assistant", "tool"),
			reasoningContent: Schema.optional(
				Schema.String.pipe(Schema.maxLength(65536)),
			),
			toolCalls: Schema.optional(
				Schema.Array(ToolCall).pipe(Schema.maxItems(16)),
			),
			toolCallId: Schema.optional(Schema.NonEmptyString),
			toolName: Schema.optional(ToolCall.fields.name),
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
