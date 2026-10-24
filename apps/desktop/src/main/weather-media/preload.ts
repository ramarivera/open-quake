import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	WEATHER_MEDIA_CHANGED,
	WEATHER_MEDIA_REQUEST,
	type WeatherMediaBridge,
} from "../../shared/weather-media-contracts";

const bridge: WeatherMediaBridge = {
	request: (command) => ipcRenderer.invoke(WEATHER_MEDIA_REQUEST, command),
	onSnapshot: (callback) => {
		const listener = (_: IpcRendererEvent, snapshot: unknown): void =>
			callback(snapshot);
		ipcRenderer.on(WEATHER_MEDIA_CHANGED, listener);
		return () => ipcRenderer.removeListener(WEATHER_MEDIA_CHANGED, listener);
	},
};
contextBridge.exposeInMainWorld("quakeWeatherMedia", bridge);
