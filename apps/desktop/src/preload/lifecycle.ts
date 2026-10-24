import { Schema } from "effect";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	ConnectionDiagnostic,
	LIFECYCLE_CHANNEL,
	LIFECYCLE_STATUS,
	type LifecycleBridge,
	LifecycleReply,
} from "../shared/lifecycle-contracts";

const bridge: LifecycleBridge = {
	request: async (command) => {
		const reply: unknown = await ipcRenderer.invoke(LIFECYCLE_CHANNEL, command);
		return Schema.is(LifecycleReply)(reply)
			? reply
			: { ok: false, code: "DESKTOP.LIFECYCLE.INVALID" };
	},
	onStatus: (callback) => {
		const listener = (_event: IpcRendererEvent, value: unknown): void => {
			if (Schema.is(ConnectionDiagnostic)(value)) callback(value);
		};
		ipcRenderer.on(LIFECYCLE_STATUS, listener);
		return () => {
			ipcRenderer.off(LIFECYCLE_STATUS, listener);
		};
	},
};
contextBridge.exposeInMainWorld("quakeLifecycle", bridge);
