import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { AssistantSettings } from "../../../device/src/profiles/assistant-contracts.js";
import {
	FileResult,
	ProviderListing,
	PublicFileRequest,
} from "../ai/ai-file-contracts.js";
import {
	ChatChunk,
	SessionId,
	TurnId,
	TurnSnapshot,
} from "./chat-contracts.js";
import { ChatHistory } from "./chat-history-contracts.js";

/** Browser-safe projection. Host-only owner and credential references never cross RPC. */
export const PublicChatHistory = ChatHistory.omit("owner");
export type PublicChatHistory = typeof PublicChatHistory.Type;
export const ChatInput = Schema.Struct({
	sessionId: SessionId,
	turnId: TurnId,
	text: Schema.String.pipe(
		Schema.minLength(1),
		Schema.maxLength(32768),
		Schema.filter((value) => value.trim().length > 0),
	),
});
export type ChatInput = typeof ChatInput.Type;
export const ChatDelivery = Schema.Union(
	Schema.TaggedStruct("snapshot", { snapshot: TurnSnapshot }),
	Schema.TaggedStruct("chunk", { chunk: ChatChunk }),
);
export type ChatDelivery = typeof ChatDelivery.Type;
/** Only catalog codes and canonical messages are projected by host handlers. */
export class ChatRpcFailure extends Schema.TaggedError<ChatRpcFailure>()(
	"ChatRpcFailure",
	{ code: Schema.String, message: Schema.String },
) {}
export const AssistantSelection = Schema.Struct({
	generation: Schema.Int,
	sessionId: SessionId,
	settings: AssistantSettings,
	transcript: Schema.optional(Schema.String.pipe(Schema.maxLength(8000))),
});
export type AssistantSelection = typeof AssistantSelection.Type;
const session = { sessionId: SessionId };
const turn = { ...session, turnId: TurnId };
export const ChatRpcs = RpcGroup.make(
	Rpc.make("assistant.read", {
		success: AssistantSettings,
		error: ChatRpcFailure,
	}),
	Rpc.make("assistant.update", {
		payload: { settings: AssistantSettings },
		success: AssistantSettings,
		error: ChatRpcFailure,
	}),
	Rpc.make("assistant.visibility", { payload: { visible: Schema.Boolean }, error: ChatRpcFailure }),
  Rpc.make("assistant.selection", {
		success: Schema.NullOr(AssistantSelection),
		error: ChatRpcFailure,
	}),
	Rpc.make("assistant.ack", {
		payload: { generation: Schema.Int },
		error: ChatRpcFailure,
	}),
	Rpc.make("provider.files", {
		payload: PublicFileRequest,
		success: FileResult,
		error: ChatRpcFailure,
	}),
	Rpc.make("provider.list", {
		success: ProviderListing,
		error: ChatRpcFailure,
	}),
	Rpc.make("chat.submit", {
		payload: ChatInput,
		success: TurnSnapshot,
		error: ChatRpcFailure,
	}),
	Rpc.make("chat.subscribe", {
		payload: turn,
		success: ChatDelivery,
		stream: true,
		error: ChatRpcFailure,
	}),
	Rpc.make("chat.snapshot", {
		payload: turn,
		success: TurnSnapshot,
		error: ChatRpcFailure,
	}),
	Rpc.make("chat.cancel", { payload: turn, error: ChatRpcFailure }),
	Rpc.make("chat.close", { payload: session, error: ChatRpcFailure }),
	Rpc.make("chat.clear", { payload: session, error: ChatRpcFailure }),
	Rpc.make("chat.rename", {
		payload: { ...session, title: Schema.String.pipe(Schema.maxLength(200)) },
		error: ChatRpcFailure,
	}),
	Rpc.make("chat.history", {
		payload: session,
		success: PublicChatHistory,
		error: ChatRpcFailure,
	}),
	Rpc.make("chat.list", {
		success: Schema.Array(PublicChatHistory),
		error: ChatRpcFailure,
	}),
);

export { RpcClient, RpcClientError, RpcServer } from "@effect/rpc";
export type {
	FromClientEncoded,
	FromServerEncoded,
} from "@effect/rpc/RpcMessage";
