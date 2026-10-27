import { Either, Schema } from "effect";
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { AUDIO_SETUP_CHANNEL } from "../../shared/audio-setup";
import {
	CAPTURE_CHUNK,
	CAPTURE_LOST,
	CAPTURE_PCM,
	CAPTURE_READY,
	CAPTURE_REPLY,
	CAPTURE_REQUEST,
	CaptureRequest,
	MEETING_REQUEST,
	MEETING_SNAPSHOT,
	type MeetingsBridge,
} from "../../shared/meeting-bridge";

const bridge: MeetingsBridge = {
	audioSetup: (request) => ipcRenderer.invoke(AUDIO_SETUP_CHANNEL, request),
	request: (command) => ipcRenderer.invoke(MEETING_REQUEST, command),
	onSnapshot: (callback) => {
		const listener = (_: IpcRendererEvent, value: unknown): void =>
			callback(value);
		ipcRenderer.on(MEETING_SNAPSHOT, listener);
		return () => ipcRenderer.off(MEETING_SNAPSHOT, listener);
	},
	onCapture: (callback) => {
		const listener = (_: IpcRendererEvent, value: unknown): void => {
			const decoded = Schema.decodeUnknownEither(CaptureRequest)(value);
			if (Either.isRight(decoded)) callback(decoded.right);
		};
		ipcRenderer.on(CAPTURE_REQUEST, listener);
		ipcRenderer.send(CAPTURE_READY);
		return () => ipcRenderer.off(CAPTURE_REQUEST, listener);
	},
	captureReply: (reply) => ipcRenderer.send(CAPTURE_REPLY, reply),
	writeChunk: (chunk) => ipcRenderer.invoke(CAPTURE_CHUNK, chunk),
	pcm: (bytes) => ipcRenderer.invoke(CAPTURE_PCM, bytes),
	sourceLost: (id) => ipcRenderer.send(CAPTURE_LOST, id),
};
contextBridge.exposeInMainWorld("quakeMeetings", bridge);
