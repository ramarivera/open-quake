import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { BrowserWindow, shell } from "electron";

/** User-selected local audio only. The playback document has no network or preload. */
export async function playKeyAlarm(
	sound: string,
	signal: AbortSignal,
): Promise<void> {
	if (sound === "beep") {
		shell.beep();
		return;
	}
	if (!isAbsolute(sound)) throw new Error("Alarm audio must be a local file");
	const info = await stat(sound);
	if (!info.isFile() || info.size > 10 * 1024 * 1024)
		throw new Error("Invalid alarm audio");
	const bytes = await readFile(sound, { signal });
	const mime =
		bytes.toString("ascii", 0, 4) === "RIFF"
			? "audio/wav"
			: bytes.toString("ascii", 0, 4) === "OggS"
				? "audio/ogg"
				: bytes.toString("ascii", 4, 8) === "ftyp"
					? "audio/mp4"
					: bytes.toString("ascii", 0, 4) === "fLaC"
						? "audio/flac"
						: "audio/mpeg";
	const win = new BrowserWindow({
		show: false,
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false,
			autoplayPolicy: "no-user-gesture-required",
		},
	});
	const stop = (): void => {
		if (!win.isDestroyed()) win.destroy();
	};
	signal.addEventListener("abort", stop, { once: true });
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		if (signal.aborted) return;
		await win.loadURL(
			`data:text/html,${encodeURIComponent("<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; media-src data:; script-src 'none'\"><audio></audio>")}`,
		);
		await Promise.race([
			win.webContents.executeJavaScript(
				`new Promise((resolve,reject)=>{const a=document.querySelector("audio");a.src=${JSON.stringify(`data:${mime};base64,${bytes.toString("base64")}`)};a.onended=()=>resolve(true);a.onerror=()=>reject(new Error("Audio decoding failed"));a.play().catch(reject)})`,
			),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error("Alarm playback timed out")),
					300000,
				);
				timeout.unref();
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
		signal.removeEventListener("abort", stop);
		stop();
	}
}
