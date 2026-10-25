import type {
	SessionId,
	TurnId,
	TurnSnapshot,
} from "../../../../packages/edge/src/chat/chat-contracts";
import type {
	ChatDelivery,
	ChatInput,
	PublicChatHistory,
} from "../../../../packages/edge/src/chat/chat-rpc";
export const CHAT_REQUEST = "chat:rpc:request";
export const CHAT_EVENT = "chat:rpc:event";
export const CHAT_DISCONNECT = "chat:rpc:disconnect";
export interface DirectChatBridge {
	readonly submit: (input: ChatInput) => Promise<TurnSnapshot>;
	readonly subscribe: (
		sessionId: SessionId,
		turnId: TurnId,
		callback: (delivery: ChatDelivery) => void,
		failed: (code: string) => void,
	) => () => void;
	readonly snapshot: (
		sessionId: SessionId,
		turnId: TurnId,
	) => Promise<TurnSnapshot>;
	readonly cancel: (sessionId: SessionId, turnId: TurnId) => Promise<void>;
	readonly close: (sessionId: SessionId) => Promise<void>;
	readonly clear: (sessionId: SessionId) => Promise<void>;
	readonly rename: (sessionId: SessionId, title: string) => Promise<void>;
	readonly history: (sessionId: SessionId) => Promise<PublicChatHistory>;
	readonly list: () => Promise<readonly PublicChatHistory[]>;
	readonly dispose: () => Promise<void>;
}
declare global {
	interface Window {
		readonly quakeChat?: DirectChatBridge;
	}
}
