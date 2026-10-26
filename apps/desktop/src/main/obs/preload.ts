import { Schema } from "effect";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	OBS_LIVE,
	OBS_REQUEST,
	type ObsBridge,
	ObsLive,
	ObsReply,
	ObsRequest,
} from "../../shared/obs";
export const obsBridge: ObsBridge = {
	request: async (input) => {
		const request = Schema.decodeUnknownSync(ObsRequest)(input, {
			onExcessProperty: "error",
		});
		return Schema.decodeUnknownSync(ObsReply)(
			await ipcRenderer.invoke(OBS_REQUEST, request),
		);
	},
	onLive: (receive) => {
		const listener = (_event: IpcRendererEvent, raw: unknown) => {
			const live = Schema.decodeUnknownEither(ObsLive)(raw);
			if (live._tag === "Right") receive(live.right);
		};
		ipcRenderer.on(OBS_LIVE, listener);
		return () => ipcRenderer.off(OBS_LIVE, listener);
	},
};
contextBridge.exposeInMainWorld("quakeObs", obsBridge);
