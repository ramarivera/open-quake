import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	PROFILE_FOREGROUND_GUIDANCE,
	PROFILE_PROGRESS,
	PROFILE_REQUEST,
	PROFILE_SELECTION,
	PROFILE_SNAPSHOT,
	type ProfileBridge,
} from "../../shared/profile-manager";

const subscribe = <T>(
	channel: string,
	callback: (value: T) => void,
): (() => void) => {
	const listener = (_event: IpcRendererEvent, value: T): void =>
		callback(value);
	ipcRenderer.on(channel, listener);
	return () => {
		ipcRenderer.off(channel, listener);
	};
};
const bridge: ProfileBridge = {
	request: (command) => ipcRenderer.invoke(PROFILE_REQUEST, command),
	onSnapshot: (callback) => subscribe(PROFILE_SNAPSHOT, callback),
	onSelection: (callback) => subscribe(PROFILE_SELECTION, callback),
	onProgress: (callback) => subscribe(PROFILE_PROGRESS, callback),
	onForegroundGuidance: (callback) =>
		subscribe(PROFILE_FOREGROUND_GUIDANCE, callback),
};
contextBridge.exposeInMainWorld("quakeProfileManager", bridge);
