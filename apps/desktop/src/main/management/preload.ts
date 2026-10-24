import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	MANAGEMENT_ACTIVATE,
	MANAGEMENT_THEME,
	type ManagementBridge,
} from "../../shared/management";

const bridge: ManagementBridge = {
	platform: process.platform,
	setTheme: (theme) => ipcRenderer.invoke(MANAGEMENT_THEME, theme),
	onActivate: (receive) => {
		const listener = (_event: IpcRendererEvent, value: unknown): void => {
			if (typeof value === "string") receive(value);
		};
		ipcRenderer.on(MANAGEMENT_ACTIVATE, listener);
		return () => ipcRenderer.off(MANAGEMENT_ACTIVATE, listener);
	},
};
contextBridge.exposeInMainWorld("quakeManagement", bridge);
