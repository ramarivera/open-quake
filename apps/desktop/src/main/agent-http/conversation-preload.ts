import { Schema } from "effect";
import {
	AGENT_CONVERSATIONS_EVENT,
	AGENT_CONVERSATIONS_REQUEST,
	type AgentConversationsBridge,
	ConversationEvent,
	ConversationReply,
} from "../../shared/agent-conversations.js";

export interface ConversationRendererIPC {
	readonly invoke: (channel: string, input: unknown) => Promise<unknown>;
	readonly on: (
		channel: string,
		listener: (event: unknown, input: unknown) => void,
	) => unknown;
	readonly removeListener: (
		channel: string,
		listener: (event: unknown, input: unknown) => void,
	) => unknown;
}
/** One listener, one event in flight per stream. Acknowledgement follows consumer delivery. */
export function createAgentConversationsBridge(
	ipc: ConversationRendererIPC,
): AgentConversationsBridge {
	const listeners = new Set<
		(event: ConversationEvent) => void | Promise<void>
	>();
	const request: AgentConversationsBridge["request"] = async (input) =>
		Schema.decodeUnknownSync(ConversationReply)(
			await ipc.invoke(AGENT_CONVERSATIONS_REQUEST, input),
			{ onExcessProperty: "error" },
		);
	const notify = (_event: unknown, input: unknown): void => {
		const decoded = Schema.decodeUnknownEither(ConversationEvent)(input, {
			onExcessProperty: "error",
		});
		if (decoded._tag !== "Right") return;
		const event = decoded.right;
		const callbacks = [...listeners];
		if (callbacks.length === 0) return;
		void Promise.all(
			callbacks.map((callback) =>
				Promise.resolve().then(() => callback(event)),
			),
		)
			.then(() =>
				listeners.size === 0
					? undefined
					: request({
							type: "ack",
							requestId: event.requestId,
							seq: event.seq,
						}),
			)
			.catch(() =>
				request({ type: "cancel", requestId: event.requestId }).catch(
					() => undefined,
				),
			);
	};
	return {
		request,
		onEvent: (callback) => {
			if (listeners.size === 0) ipc.on(AGENT_CONVERSATIONS_EVENT, notify);
			listeners.add(callback);
			let removed = false;
			return () => {
				if (removed) return;
				removed = true;
				listeners.delete(callback);
				if (listeners.size === 0) {
					ipc.removeListener(AGENT_CONVERSATIONS_EVENT, notify);
					void request({ type: "unsubscribe" }).catch(() => undefined);
				}
			};
		},
	};
}
