import { contextBridge, ipcRenderer } from "electron";
import {
	SPEECH_SETTINGS_CHANNEL,
	type SpeechSettingsBridge,
} from "../../shared/speech";
export const createSpeechSettingsBridge = (
	ipc: Pick<typeof ipcRenderer, "invoke">,
): SpeechSettingsBridge => ({
	request: (input) => ipc.invoke(SPEECH_SETTINGS_CHANNEL, input),
});
contextBridge.exposeInMainWorld(
	"quakeSpeech",
	createSpeechSettingsBridge(ipcRenderer),
);
