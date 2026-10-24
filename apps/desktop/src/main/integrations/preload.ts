import { Schema } from "effect";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { HaLive } from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import {
	INTEGRATIONS_LIVE,
	INTEGRATIONS_REQUEST,
	IntegrationReply,
	type IntegrationsBridge,
} from "../../shared/integrations";
export const integrationsBridge: IntegrationsBridge = {
	request: async (request) =>
		Schema.decodeUnknownSync(IntegrationReply)(
			await ipcRenderer.invoke(INTEGRATIONS_REQUEST, request),
		),
	onHaLive: (receive) => {
		const listener = (_event: IpcRendererEvent, raw: unknown) => {
			const decoded = Schema.decodeUnknownEither(HaLive)(raw);
			if (decoded._tag === "Right") receive(decoded.right);
		};
		ipcRenderer.on(INTEGRATIONS_LIVE, listener);
		return () => ipcRenderer.off(INTEGRATIONS_LIVE, listener);
	},
};
contextBridge.exposeInMainWorld("quakeIntegrations", integrationsBridge);
