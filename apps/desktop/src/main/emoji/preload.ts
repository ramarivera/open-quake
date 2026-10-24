import { contextBridge, ipcRenderer } from "electron";
import {
	EMOJI_PRESS,
	EMOJI_REQUEST,
	type EmojiBridge,
} from "../../shared/emoji";

const bridge: EmojiBridge = {
	request: (input) => ipcRenderer.invoke(EMOJI_REQUEST, input),
	press: (input) => ipcRenderer.invoke(EMOJI_PRESS, input),
};
contextBridge.exposeInMainWorld("quakeEmoji", bridge);
