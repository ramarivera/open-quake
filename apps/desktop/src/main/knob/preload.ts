import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	KNOB_REQUEST,
	KNOB_SNAPSHOT,
	type KnobBridge,
} from "../../shared/knob-contracts";

const bridge: KnobBridge = {
	request: (command) => ipcRenderer.invoke(KNOB_REQUEST, command),
	onSnapshot: (callback) => {
		const listener = (_event: IpcRendererEvent, snapshot: unknown): void =>
			callback(snapshot);
		ipcRenderer.on(KNOB_SNAPSHOT, listener);
		return () => {
			ipcRenderer.off(KNOB_SNAPSHOT, listener);
		};
	},
};
contextBridge.exposeInMainWorld("quakeKnob", bridge);
