import { Schema } from "effect";
import {
	RuntimeAgent,
	RuntimeBaseURL,
	RuntimeCapabilities,
	RuntimeConnectionId,
	RuntimeConnectionView,
	RuntimeHealth,
	RuntimeKind,
	RuntimeModel,
} from "../../../../packages/edge/src/agent-http/runtime-contracts.js";

export const AGENT_CONNECTIONS_REQUEST = "agent-connections:request";
export const AGENT_CONNECTIONS_SNAPSHOT = "agent-connections:snapshot";
export const AgentConnectionSelection = Schema.Struct({
	connectionId: RuntimeConnectionId,
	agentId: Schema.optional(
		Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(256)),
	),
});
export type AgentConnectionSelection = typeof AgentConnectionSelection.Type;
export const AgentConnectionView = Schema.Struct({
	revision: Schema.Int.pipe(Schema.nonNegative()),
	connections: Schema.Array(RuntimeConnectionView).pipe(Schema.maxItems(100)),
	selected: Schema.optional(AgentConnectionSelection),
	cleanupPending: Schema.Boolean,
});
export type AgentConnectionView = typeof AgentConnectionView.Type;
export const AgentConnectionDiscovery = Schema.Struct({
	capabilities: RuntimeCapabilities,
	agents: Schema.Array(RuntimeAgent).pipe(Schema.maxItems(1000)),
	models: Schema.optional(
		Schema.Array(RuntimeModel).pipe(Schema.maxItems(1000)),
	),
});
export type AgentConnectionDiscovery = typeof AgentConnectionDiscovery.Type;
export const SaveAgentConnection = Schema.Struct({
	type: Schema.Literal("save"),
	id: Schema.optional(RuntimeConnectionId),
	name: RuntimeConnectionView.fields.name,
	kind: RuntimeKind,
	baseURL: RuntimeBaseURL,
	credential: Schema.optional(
		Schema.NonEmptyTrimmedString.pipe(
			Schema.maxLength(16384),
			Schema.filter((value) =>
				Array.from(value).every(
					(character) =>
						character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
				),
			),
		),
	),
	clearCredential: Schema.optional(Schema.Boolean),
});
export type SaveAgentConnection = typeof SaveAgentConnection.Type;
export const AgentConnectionCommand = Schema.Union(
	Schema.Struct({ type: Schema.Literal("list") }),
	SaveAgentConnection,
	Schema.Struct({ type: Schema.Literal("test"), id: RuntimeConnectionId }),
	Schema.Struct({ type: Schema.Literal("discover"), id: RuntimeConnectionId }),
	Schema.Struct({
		type: Schema.Literal("select"),
		id: Schema.optional(RuntimeConnectionId),
		agentId: AgentConnectionSelection.fields.agentId,
	}),
	Schema.Struct({ type: Schema.Literal("remove"), id: RuntimeConnectionId }),
);
export type AgentConnectionCommand = typeof AgentConnectionCommand.Type;
export const AgentConnectionReply = Schema.Union(
	Schema.TaggedStruct("success", {
		view: AgentConnectionView,
		health: Schema.optional(RuntimeHealth),
		discovery: Schema.optional(AgentConnectionDiscovery),
	}),
	Schema.TaggedStruct("rejected", {
		code: Schema.String,
		message: Schema.String,
	}),
);
export type AgentConnectionReply = typeof AgentConnectionReply.Type;
export interface AgentConnectionsBridge {
	readonly request: (
		command: AgentConnectionCommand,
	) => Promise<AgentConnectionReply>;
	readonly onSnapshot: (
		receive: (view: AgentConnectionView) => void,
	) => () => void;
}
declare global {
	interface Window {
		readonly quakeAgentConnections: AgentConnectionsBridge;
	}
}
