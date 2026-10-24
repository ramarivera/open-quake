import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	CLOCK_REQUEST,
	CLOCK_SNAPSHOT,
	type ClockBridge,
} from "../../shared/clock-contracts";

const bridge: ClockBridge = {
	request: (command) => ipcRenderer.invoke(CLOCK_REQUEST, command),
	onSnapshot: (callback) => {
		const listener = (_event: IpcRendererEvent, value: unknown): void =>
			callback(value);
		ipcRenderer.on(CLOCK_SNAPSHOT, listener);
		return () => {
			ipcRenderer.off(CLOCK_SNAPSHOT, listener);
		};
	},
};
contextBridge.exposeInMainWorld("quakeClock", bridge);
