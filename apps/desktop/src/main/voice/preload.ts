import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	VOICE_REQUEST_CHANNEL,
	VOICE_SURFACE_CHANNEL,
	type VoiceBridge,
} from "../../shared/voice-surface";

const bridge: VoiceBridge = {
	onEvent: (callback) => {
		const listener = (_event: IpcRendererEvent, value: unknown): void =>
			callback(value);
		ipcRenderer.on(VOICE_SURFACE_CHANNEL, listener);
		// Main answers with the agent status, including after reloads.
		void ipcRenderer.invoke(VOICE_REQUEST_CHANNEL, { _tag: "Hello" });
		return () => {
			ipcRenderer.off(VOICE_SURFACE_CHANNEL, listener);
		};
	},
	request: (request) => ipcRenderer.invoke(VOICE_REQUEST_CHANNEL, request),
};
contextBridge.exposeInMainWorld("quakeVoice", bridge);
