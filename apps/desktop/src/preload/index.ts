import { createSettingsBackendBridge } from "../main/settings/backend-preload";
import { createAppLocaleBridge } from "../main/settings/preload";
import "../main/meetings/preload";
import { createDirectChatBridge } from "../main/chat/preload";
import "../main/maintenance/preload";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { createAgentConnectionsBridge } from "../main/agent-http/connection-preload";
import { createAgentConversationsBridge } from "../main/agent-http/conversation-preload";
import "../main/key-library/preload";
import "../main/clock/preload";
import "../main/monitor/preload";
import "../main/media/preload";
import "./lifecycle";
import "../main/management/preload";
import "../main/emoji/preload";
import "../main/agents/preload";
import "../main/integrations/preload";
import "../main/knob/preload";
import "../main/hardware/preload";
import "../main/profiles/preload";
import "../main/weather-media/preload";
import "../main/voice/preload";
import "../main/profiles/manager-preload";
import {
	type OpenQuakeBridge,
	QUAKE_EVENT_CHANNEL,
	QUAKE_STATUS_CHANNEL,
	type QuakeEvent,
} from "./quake";

// SDK surface exposed to the renderer lands here (wayfinder ticket
// open-quake-2qs.5 / open-quake-2qs.6).
const bridge: OpenQuakeBridge = {
	version: "0.0.0",
	onQuakeEvent: (cb): (() => void) => {
		const listener = (_: IpcRendererEvent, event: QuakeEvent): void =>
			cb(event);
		ipcRenderer.on(QUAKE_EVENT_CHANNEL, listener);
		ipcRenderer.send(QUAKE_STATUS_CHANNEL);
		return () => {
			ipcRenderer.off(QUAKE_EVENT_CHANNEL, listener);
		};
	},
};

contextBridge.exposeInMainWorld("openQuake", bridge);
contextBridge.exposeInMainWorld(
	"quakeAgentConnections",
	createAgentConnectionsBridge(ipcRenderer),
);
contextBridge.exposeInMainWorld(
	"quakeAgentConversations",
	createAgentConversationsBridge(ipcRenderer),
);

const directChat = createDirectChatBridge(ipcRenderer, {
	disconnectOnDispose: false,
});
contextBridge.exposeInMainWorld("quakeChat", directChat);
window.addEventListener("unload", () => {
	void directChat.dispose();
});

const appLocale = createAppLocaleBridge(ipcRenderer);
contextBridge.exposeInMainWorld("quakeLocale", appLocale);
window.addEventListener("unload", () => {
	void appLocale.dispose();
});

const settingsBackend = createSettingsBackendBridge(ipcRenderer);
contextBridge.exposeInMainWorld("quakeSettings", settingsBackend);
window.addEventListener("unload", () => {
	void settingsBackend.dispose();
});
