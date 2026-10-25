import { Schema } from "effect";
import {
	ConversationHistory,
	ConversationScope,
	ConversationStart,
} from "../../../../packages/edge/src/agent-http/conversation-repository.js";
import { ConversationEvent } from "../../../../packages/edge/src/agent-http/conversation-service.js";

export {
	ConversationEvent,
	ConversationHistory,
	ConversationScope,
	ConversationStart,
};
export const AGENT_CONVERSATIONS_REQUEST = "agent-http:conversations:request";
export const AGENT_CONVERSATIONS_EVENT = "agent-http:conversations:event";
export const ConversationCommand = Schema.Union(
	Schema.Struct({ type: Schema.Literal("start"), ...ConversationStart.fields }),
	Schema.Struct({
		type: Schema.Literal("history"),
		...ConversationScope.fields,
	}),
	Schema.Struct({ type: Schema.Literal("clear"), ...ConversationScope.fields }),
	Schema.Struct({
		type: Schema.Literal("cancel"),
		requestId: ConversationStart.fields.requestId,
	}),
	Schema.Struct({
		type: Schema.Literal("ack"),
		requestId: ConversationStart.fields.requestId,
		seq: Schema.Int.pipe(Schema.nonNegative()),
	}),
	Schema.Struct({ type: Schema.Literal("unsubscribe") }),
);
export type ConversationCommand = typeof ConversationCommand.Type;
export const ConversationReply = Schema.Union(
	Schema.Struct({
		_tag: Schema.Literal("success"),
		requestId: Schema.optional(ConversationStart.fields.requestId),
		sessionId: Schema.optional(ConversationStart.fields.requestId),
		history: Schema.Array(ConversationHistory),
	}),
	Schema.Struct({
		_tag: Schema.Literal("rejected"),
		code: Schema.String,
		message: Schema.String,
	}),
);
export type ConversationReply = typeof ConversationReply.Type;
export interface AgentConversationsBridge {
	readonly request: (
		command: ConversationCommand,
	) => Promise<ConversationReply>;
	readonly onEvent: (
		callback: (event: ConversationEvent) => void | Promise<void>,
	) => () => void;
}
declare global {
	interface Window {
		quakeAgentConversations: AgentConversationsBridge;
	}
}
