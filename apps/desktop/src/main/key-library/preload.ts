import { Either, Schema } from "effect";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
	KEY_LIBRARY_CHANGED,
	KEY_PREVIEW,
	KEY_REQUEST,
	KEY_RUNTIME,
	type KeyLibraryBridge,
	KeyPreview,
	KeyReply,
	KeyRuntimeState,
} from "../../shared/key-library";

const subscribe = <T>(
	channel: string,
	schema: Schema.Schema<T>,
	callback: (value: T) => void,
): (() => void) => {
	const listener = (_: IpcRendererEvent, value: unknown): void => {
		const decoded = Schema.decodeUnknownEither(schema)(value);
		if (Either.isRight(decoded)) callback(decoded.right);
	};
	ipcRenderer.on(channel, listener);
	return () => ipcRenderer.off(channel, listener);
};
const bridge: KeyLibraryBridge = {
	onLibraryChange: (callback) => {
		const listener = (): void => callback();
		ipcRenderer.on(KEY_LIBRARY_CHANGED, listener);
		return () => {
			ipcRenderer.off(KEY_LIBRARY_CHANGED, listener);
		};
	},
	request: async (request) =>
		Schema.decodeUnknownSync(KeyReply)(
			await ipcRenderer.invoke(KEY_REQUEST, request),
		),
	onPreview: (callback) => subscribe(KEY_PREVIEW, KeyPreview, callback),
	onRuntime: (callback) => subscribe(KEY_RUNTIME, KeyRuntimeState, callback),
};
contextBridge.exposeInMainWorld("quakeKeyLibrary", bridge);
