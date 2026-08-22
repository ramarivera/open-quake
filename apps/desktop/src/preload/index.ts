import { contextBridge, ipcRenderer } from "electron";

// SDK surface exposed to the renderer lands here (wayfinder ticket
// open-quake-2qs.5 / open-quake-2qs.6).
contextBridge.exposeInMainWorld("openQuake", {
	version: "0.0.0",
	onQuakeEvent: (cb: (event: unknown) => void): (() => void) => {
		const listener = (_: unknown, event: unknown): void => cb(event);
		ipcRenderer.on("quake:event", listener);
		return () => ipcRenderer.off("quake:event", listener);
	},
});
