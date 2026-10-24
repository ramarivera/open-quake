import { Effect } from "effect";
import { BrowserWindow, type WebContents } from "electron";
import { ClockMediaUnusable } from "../../shared/clock-errors";
import {
	probeVideoDuration,
	VIDEO_PROBE_TIMEOUT_MS,
} from "../../shared/clock-video-probe";

const PROBE_DOCUMENT = `data:text/html,${encodeURIComponent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; media-src oq-clock-media:">')}`;
const probes = new Set<number>();

export const isClockVideoProbe = (contents: WebContents): boolean =>
	probes.has(contents.id) && contents.getURL() === PROBE_DOCUMENT;

/** Decode in an isolated, main-owned document with no preload or app bridge. */
export const probeClockVideo = (
	token: string,
): Effect.Effect<number, ClockMediaUnusable> =>
	Effect.tryPromise({
		try: async () => {
			const window = new BrowserWindow({
				show: false,
				webPreferences: {
					sandbox: true,
					contextIsolation: true,
					nodeIntegration: false,
				},
			});
			const id = window.webContents.id;
			probes.add(id);
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				const decoded = await Promise.race([
					(async (): Promise<unknown> => {
						await window.loadURL(PROBE_DOCUMENT);
						// Supply every argument so the serialized browser function has
						// no dependencies on module constants or the main environment.
						return window.webContents.executeJavaScript(
							`(${probeVideoDuration.toString()})(${JSON.stringify(`oq-clock-media://candidate/${token}`)}, () => document.createElement('video'), ${VIDEO_PROBE_TIMEOUT_MS}, globalThis)`,
						);
					})(),
					new Promise<null>((resolve) => {
						timer = setTimeout(() => resolve(null), VIDEO_PROBE_TIMEOUT_MS);
					}),
				]);
				if (
					typeof decoded !== "number" ||
					!Number.isFinite(decoded) ||
					decoded <= 0
				)
					throw ClockMediaUnusable.fromCause(undefined);
				return decoded;
			} finally {
				clearTimeout(timer);
				probes.delete(id);
				if (!window.isDestroyed()) window.destroy();
			}
		},
		catch: (cause) => ClockMediaUnusable.fromCause(cause),
	});
