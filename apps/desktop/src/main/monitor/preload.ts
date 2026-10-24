import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	MONITOR_METRICS,
	MONITOR_REQUEST,
	MONITOR_SETTINGS,
	type MonitorBridge,
} from "../../shared/monitor-contracts";

const subscribe = (
	channel: string,
	callback: (value: unknown) => void,
): (() => void) => {
	const listener = (_event: IpcRendererEvent, value: unknown): void =>
		callback(value);
	ipcRenderer.on(channel, listener);
	return () => {
		ipcRenderer.off(channel, listener);
	};
};
const bridge: MonitorBridge = {
	request: (command) => ipcRenderer.invoke(MONITOR_REQUEST, command),
	onSettings: (callback) => subscribe(MONITOR_SETTINGS, callback),
	onMetrics: (callback) => subscribe(MONITOR_METRICS, callback),
};
contextBridge.exposeInMainWorld("quakeMonitor", bridge);
