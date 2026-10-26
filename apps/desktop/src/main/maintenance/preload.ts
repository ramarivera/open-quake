import { Schema } from "effect";
import { contextBridge, ipcRenderer } from "electron";
import {
	FIRMWARE_PROGRESS_CHANNEL,
	FirmwareSnapshot,
	MAINTENANCE_CHANNEL,
	type MaintenanceBridge,
} from "../../shared/maintenance-contracts";

const bridge: MaintenanceBridge = {
	subscribeFirmware: (listener) => {
		const receive = (_event: Electron.IpcRendererEvent, input: unknown) => {
			if (Schema.is(FirmwareSnapshot)(input)) listener(input);
		};
		ipcRenderer.on(FIRMWARE_PROGRESS_CHANNEL, receive);
		return () => ipcRenderer.removeListener(FIRMWARE_PROGRESS_CHANNEL, receive);
	},
	request: (command) => ipcRenderer.invoke(MAINTENANCE_CHANNEL, command),
};
contextBridge.exposeInMainWorld("quakeMaintenance", bridge);
