import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { BrowserWindow, nativeImage } from "electron";
import { probeVideoDuration } from "../../shared/clock-video-probe";
import {
	MonitorMediaUnusable,
	MonitorVideoTooShort,
} from "../../shared/monitor-errors";
import type { SelectedMedia } from "./monitor-store";
/** Native decoder is authoritative. No renderer-supplied duration or filesystem path. */
export async function selectMedia(path: string): Promise<SelectedMedia> {
	const extension = extname(path).toLowerCase();
	const videoMime: Readonly<Record<string, string>> = {
		".mp4": "video/mp4",
		".webm": "video/webm",
		".mov": "video/quicktime",
		".mkv": "video/x-matroska",
	};
	const mime = videoMime[extension];
	const size = (await stat(path)).size;
	if (size <= 0 || size > (mime ? 32 : 8) * 1024 * 1024)
		throw new MonitorMediaUnusable();
	const bytes = await readFile(path);
	if (!mime) {
		const image = nativeImage.createFromBuffer(bytes);
		const dimensions = image.getSize();
		if (image.isEmpty() || dimensions.width * dimensions.height > 64_000_000)
			throw new MonitorMediaUnusable();
		return {
			bytes: image.toPNG(),
			mime: "image/png",
			kind: "image",
			name: basename(path),
		};
	}
	const window = new BrowserWindow({
		show: false,
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const url = `data:${mime};base64,${bytes.toString("base64")}`;
		const duration: unknown = await Promise.race([
			(async () => {
				await window.loadURL(
					`data:text/html,${encodeURIComponent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; media-src data:">')}`,
				);
				return window.webContents.executeJavaScript(
					`(${probeVideoDuration.toString()})(${JSON.stringify(url)}, () => document.createElement('video'), 6000, globalThis)`,
				);
			})(),
			new Promise<undefined>((resolve) => {
				timer = globalThis.setTimeout(() => resolve(undefined), 6500);
			}),
		]);
		if (typeof duration !== "number" || !Number.isFinite(duration))
			throw new MonitorMediaUnusable();
		if (duration < 2000) throw new MonitorVideoTooShort();
		return { bytes, mime, kind: "video", name: basename(path) };
	} finally {
		clearTimeout(timer);
		if (!window.isDestroyed()) window.destroy();
	}
}
