import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	WALLPAPER_CLOCK,
	WALLPAPER_REQUEST,
	WALLPAPER_SNAPSHOT,
	type WallpaperBridge,
} from "../../renderer/src/wallpaper/wallpaper-contracts";

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
const bridge: WallpaperBridge = {
	request: (command) => ipcRenderer.invoke(WALLPAPER_REQUEST, command),
	onSnapshot: (callback) => subscribe(WALLPAPER_SNAPSHOT, callback),
	onClock: (callback) => subscribe(WALLPAPER_CLOCK, callback),
};
contextBridge.exposeInMainWorld("quakeWallpaper", bridge);
