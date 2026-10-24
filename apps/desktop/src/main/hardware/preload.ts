import { contextBridge, ipcRenderer } from "electron";
import {
	HARDWARE_REQUEST,
	type HardwareBridge,
} from "../../shared/hardware-contracts";

const bridge: HardwareBridge = {
	request: (command) => ipcRenderer.invoke(HARDWARE_REQUEST, command),
};
contextBridge.exposeInMainWorld("quakeHardware", bridge);
