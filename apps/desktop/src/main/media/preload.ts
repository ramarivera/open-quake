import { Schema } from "effect";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	WALLPAPER_AUDIO,
	WALLPAPER_CLOCK,
	WALLPAPER_REQUEST,
	WALLPAPER_SNAPSHOT,
	type WallpaperBridge,
	WallpaperReply,
} from "../../shared/wallpaper-contracts";
import { WallpaperReceiver } from "../../shared/wallpaper-transfer";

const subscribe = (
	channel: string,
	callback: (value: unknown) => void,
): (() => void) => {
	const listener = (_event: IpcRendererEvent, value: unknown): void =>
		callback(value);
	ipcRenderer.on(channel, listener);
	return () => {
		ipcRenderer.off(channel, listener);
	};
};
const receiver = new WallpaperReceiver();
const bridge: WallpaperBridge = {
	audio: (command) => ipcRenderer.invoke(WALLPAPER_AUDIO, command),
	request: async (command) => {
		const reply: unknown = await ipcRenderer.invoke(WALLPAPER_REQUEST, command);
		if (
			Schema.is(WallpaperReply)(reply) &&
			reply._tag === "success" &&
			command._tag !== "pick" &&
			command._tag !== "discard"
		)
			receiver.decode(reply.snapshot);
		return reply;
	},
	onSnapshot: (callback) =>
		subscribe(WALLPAPER_SNAPSHOT, (input) => {
			const snapshot = receiver.decode(input);
			if (snapshot) callback(snapshot);
			else
				void ipcRenderer
					.invoke(WALLPAPER_REQUEST, { _tag: "read" })
					.then((reply: unknown) => {
						if (Schema.is(WallpaperReply)(reply) && reply._tag === "success") {
							receiver.decode(reply.snapshot);
							callback(reply.snapshot);
						}
					})
					.catch(() => {});
		}),
	onClock: (callback) => subscribe(WALLPAPER_CLOCK, callback),
};
contextBridge.exposeInMainWorld("quakeWallpaper", bridge);
