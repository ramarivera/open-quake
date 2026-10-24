import type {
	AgentInput,
	AgentReply,
	AgentView,
	PanelProgress,
} from "../../../../packages/edge/src/agents/agents-contracts.js";

export * from "../../../../packages/edge/src/agents/agents-contracts.js";
export const AGENTS_REQUEST = "agents:request";
export const AGENTS_PROGRESS = "agents:progress";
export const AGENTS_SNAPSHOT = "agents:snapshot";
export interface AgentsBridge {
	readonly request: (input: AgentInput) => Promise<AgentReply>;
	readonly onProgress: (
		callback: (progress: PanelProgress) => void,
	) => () => void;
	readonly onSnapshot: (callback: (view: AgentView) => void) => () => void;
}
declare global {
	interface Window {
		readonly quakeAgents: AgentsBridge;
	}
}
