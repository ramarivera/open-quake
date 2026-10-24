import { contextBridge, ipcRenderer } from "electron";
import {
	MAINTENANCE_CHANNEL,
	type MaintenanceBridge,
} from "../../shared/maintenance-contracts";

const bridge: MaintenanceBridge = {
	request: (command) => ipcRenderer.invoke(MAINTENANCE_CHANNEL, command),
};
contextBridge.exposeInMainWorld("quakeMaintenance", bridge);
