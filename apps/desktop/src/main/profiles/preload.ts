import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	PROFILES_READ,
	PROFILES_SNAPSHOT,
	type ProfilesBridge,
} from "../../shared/profile-snapshot-contracts";

const bridge: ProfilesBridge = {
	read: () => ipcRenderer.invoke(PROFILES_READ),
	onSnapshot: (callback) => {
		const listener = (_event: IpcRendererEvent, value: unknown): void =>
			callback(value);
		ipcRenderer.on(PROFILES_SNAPSHOT, listener);
		return () => {
			ipcRenderer.off(PROFILES_SNAPSHOT, listener);
		};
	},
};
contextBridge.exposeInMainWorld("quakeProfiles", bridge);
