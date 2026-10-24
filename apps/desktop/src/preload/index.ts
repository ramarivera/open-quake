import "../main/maintenance/preload";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import "../main/clock/preload";
import "../main/monitor/preload";
import "../main/media/preload";
import "./lifecycle";
import "../main/knob/preload";
import "../main/hardware/preload";
import "../main/profiles/preload";
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
