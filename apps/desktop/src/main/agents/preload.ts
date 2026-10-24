import { Schema } from "effect";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	AGENTS_PROGRESS,
	AGENTS_REQUEST,
	AGENTS_SNAPSHOT,
	AgentReply,
	type AgentsBridge,
	AgentView,
	PanelProgress,
} from "../../shared/agents";
export const agentsBridge: AgentsBridge = {
	request: async (input) =>
		Schema.decodeUnknownSync(AgentReply)(
			await ipcRenderer.invoke(AGENTS_REQUEST, input),
		),
	onProgress: (callback) => {
		const listener = (_event: IpcRendererEvent, input: unknown): void => {
			const decoded = Schema.decodeUnknownEither(PanelProgress)(input);
			if (decoded._tag === "Right") callback(decoded.right);
		};
		ipcRenderer.on(AGENTS_PROGRESS, listener);
		return () => {
			ipcRenderer.off(AGENTS_PROGRESS, listener);
		};
	},
	onSnapshot: (callback) => {
		const listener = (_event: IpcRendererEvent, input: unknown): void => {
			const decoded = Schema.decodeUnknownEither(AgentView)(input);
			if (decoded._tag === "Right") callback(decoded.right);
		};
		ipcRenderer.on(AGENTS_SNAPSHOT, listener);
		return () => {
			ipcRenderer.off(AGENTS_SNAPSHOT, listener);
		};
	},
};
contextBridge.exposeInMainWorld("quakeAgents", agentsBridge);
