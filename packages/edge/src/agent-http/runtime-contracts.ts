import { Schema } from "effect";
import { CapabilityStatus, Usage } from "../ai/ai-contracts.js";
import { isRuntimeBaseURL } from "./runtime-invariants.js";

export const RuntimeKind = Schema.Literal("openclaw", "hermes");
export type RuntimeKind = typeof RuntimeKind.Type;
const Identifier = Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(256));
export const RuntimeConnectionId = Identifier;
export type RuntimeConnectionId = typeof RuntimeConnectionId.Type;
export const RuntimeBaseURL = Schema.String.pipe(
	Schema.filter(isRuntimeBaseURL),
);
export const RuntimeConnection = Schema.Struct({
	id: RuntimeConnectionId,
	name: Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(120)),
	kind: RuntimeKind,
	baseURL: RuntimeBaseURL,
	credentialRef: Schema.optional(Identifier),
});
export type RuntimeConnection = typeof RuntimeConnection.Type;
/** Deliberate public allowlist. No secret or credential reference crosses IPC. */
export const RuntimeConnectionView = Schema.Struct({
	id: RuntimeConnectionId,
	name: RuntimeConnection.fields.name,
	kind: RuntimeKind,
	baseURL: RuntimeBaseURL,
	credentialAvailable: Schema.Boolean,
});
export type RuntimeConnectionView = typeof RuntimeConnectionView.Type;
export const RuntimeCapability = Schema.Literal(
	"health",
	"chat",
	"listAgents",
	"sessions",
	"resources",
	"models",
	"toolEvents",
	"usage",
);
export type RuntimeCapability = typeof RuntimeCapability.Type;
export const RuntimeCapabilities = Schema.Struct({
	health: CapabilityStatus,
	chat: CapabilityStatus,
	listAgents: CapabilityStatus,
	sessions: CapabilityStatus,
	resources: CapabilityStatus,
	models: CapabilityStatus,
	toolEvents: CapabilityStatus,
	usage: CapabilityStatus,
});
export type RuntimeCapabilities = typeof RuntimeCapabilities.Type;
export const RuntimeHealth = Schema.Struct({
	status: Schema.Literal(
		"ready",
		"unavailable",
		"authenticationRequired",
		"error",
	),
	lifecycle: Schema.Literal("externallyManaged"),
});
export type RuntimeHealth = typeof RuntimeHealth.Type;
/** Remote IDs are opaque protocol identifiers, not local workspace AgentId values. */
export const RuntimeAgent = Schema.Struct({
	id: Identifier,
	name: Schema.String,
});
export type RuntimeAgent = typeof RuntimeAgent.Type;
export const RuntimeSession = Schema.Struct({
	id: Identifier,
	agentId: Schema.optional(Identifier),
	title: Schema.optional(Schema.String),
});
export type RuntimeSession = typeof RuntimeSession.Type;
export const RuntimeResource = Schema.Struct({
	id: Identifier,
	name: Schema.String,
	kind: Schema.Literal("file", "skill", "other"),
});
export type RuntimeResource = typeof RuntimeResource.Type;
export const RuntimeModel = Schema.Struct({
	id: Identifier,
	name: Schema.String,
});
export type RuntimeModel = typeof RuntimeModel.Type;
export const RuntimeMessage = Schema.Struct({
	role: Schema.Literal("system", "user", "assistant"),
	content: Schema.String.pipe(Schema.maxLength(262144)),
});
export type RuntimeMessage = typeof RuntimeMessage.Type;
export const RuntimeConversationRequest = Schema.Struct({
	connectionId: RuntimeConnectionId,
	conversationId: Identifier,
	agentId: Schema.optional(Identifier),
	sessionId: Schema.optional(Identifier),
	modelId: Schema.optional(Identifier),
	messages: Schema.Array(RuntimeMessage).pipe(
		Schema.minItems(1),
		Schema.maxItems(256),
	),
});
export type RuntimeConversationRequest = typeof RuntimeConversationRequest.Type;
/** Backend failures use the stream error channel. A successful stream completes once. */
export const RuntimeConversationEvent = Schema.Union(
	Schema.TaggedStruct("textDelta", {
		textDelta: Schema.String,
		kind: Schema.Literal("generation"),
	}),
	Schema.TaggedStruct("status", {
		kind: Schema.String,
		text: Schema.String,
		sessionId: Schema.optional(Identifier),
	}),
	Schema.TaggedStruct("tool", {
		toolCallId: Identifier,
		tool: Schema.String,
		phase: Schema.Literal("requested", "running", "completed", "failed"),
		label: Schema.optional(Schema.String),
		arguments: Schema.optional(Schema.String),
	}),
	Schema.TaggedStruct("usage", { usage: Usage }),
	Schema.TaggedStruct("completed", { sessionId: Schema.optional(Identifier) }),
);
export type RuntimeConversationEvent = typeof RuntimeConversationEvent.Type;
