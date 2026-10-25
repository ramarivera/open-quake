import { Schema } from "effect";
import {
	AGENT_CONNECTIONS_REQUEST,
	AGENT_CONNECTIONS_SNAPSHOT,
	AgentConnectionReply,
	type AgentConnectionsBridge,
	AgentConnectionView,
} from "../../shared/agent-connections";
export interface ConnectionPreloadIPC {
	readonly invoke: (channel: string, input: unknown) => Promise<unknown>;
	readonly on: (
		channel: string,
		listener: (event: unknown, input: unknown) => void,
	) => unknown;
	readonly off: (
		channel: string,
		listener: (event: unknown, input: unknown) => void,
	) => unknown;
}
/** Factory only. The preload root decides whether to expose this management bridge. */
export function createAgentConnectionsBridge(
	ipc: ConnectionPreloadIPC,
): AgentConnectionsBridge {
	return {
		request: async (command) =>
			Schema.decodeUnknownSync(AgentConnectionReply, {
				onExcessProperty: "error",
			})(await ipc.invoke(AGENT_CONNECTIONS_REQUEST, command)),
		onSnapshot: (receive) => {
			let active = true;
			const listener = (_event: unknown, input: unknown): void => {
				const result = Schema.decodeUnknownEither(AgentConnectionView, {
					onExcessProperty: "error",
				})(input);
				if (active && result._tag === "Right") receive(result.right);
			};
			ipc.on(AGENT_CONNECTIONS_SNAPSHOT, listener);
			return () => {
				if (!active) return;
				active = false;
				ipc.off(AGENT_CONNECTIONS_SNAPSHOT, listener);
			};
		},
	};
}
