import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	MANAGEMENT_ACTIVATE,
	MANAGEMENT_COMMAND,
	MANAGEMENT_DEVICES,
	MANAGEMENT_EXTERNAL,
	MANAGEMENT_THEME,
	type ManagementBridge,
} from "../../shared/management";

import { installManagementExternalLinks } from "./external-preload";

installManagementExternalLinks(document, process.isMainFrame, (url) => {
	ipcRenderer.send(MANAGEMENT_EXTERNAL, url);
});

const bridge: ManagementBridge = {
	platform: process.platform,
	devices: (request) => ipcRenderer.invoke(MANAGEMENT_DEVICES, request),
	command: (command) => ipcRenderer.invoke(MANAGEMENT_COMMAND, command),
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
