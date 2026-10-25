import { Schema } from "effect";
import { type BrowserWindow, ipcMain } from "electron";
import {
	RuntimeConnectionInvalid,
	RuntimeUnavailable,
} from "../../../../../packages/edge/src/agent-http/runtime-errors";
import {
	AGENT_CONNECTIONS_REQUEST,
	AgentConnectionCommand,
	type AgentConnectionReply,
} from "../../shared/agent-connections";
import { agentRequestAllowed } from "../agents/controller";

/** Failed construction has no owner. Report that fact through the existing protocol. */
export function registerUnavailableAgentConnections(options: {
	readonly management: () => BrowserWindow | undefined;
	readonly renderer: string;
}): () => void {
	let disposed = false;
	ipcMain.handle(
		AGENT_CONNECTIONS_REQUEST,
		(event, input: unknown): AgentConnectionReply => {
			const window = options.management();
			if (
				disposed ||
				!window ||
				window.isDestroyed() ||
				!agentRequestAllowed(
					{
						senderId: event.sender.id,
						frameURL: event.senderFrame?.url ?? "",
						mainFrame: event.senderFrame === event.sender.mainFrame,
					},
					window.webContents.id,
					options.renderer,
				)
			)
				return {
					_tag: "rejected",
					code: "AGENT.HTTP.IPC.UNAUTHORIZED",
					message: "Unauthorized runtime connection request",
				};
			const valid = Schema.is(AgentConnectionCommand, {
				onExcessProperty: "error",
			})(input);
			const error = valid
				? new RuntimeUnavailable()
				: new RuntimeConnectionInvalid();
			return { _tag: "rejected", code: error.code, message: error.message };
		},
	);
	return () => {
		if (disposed) return;
		disposed = true;
		ipcMain.removeHandler(AGENT_CONNECTIONS_REQUEST);
	};
}
