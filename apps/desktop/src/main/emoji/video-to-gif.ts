import { Schema } from "effect";
import { BrowserWindow } from "electron";
import { EmojiInvalid } from "../../../../../packages/edge/src/emoji/emoji-errors";
import { encodeGif } from "../../shared/gif";

const framesSchema = Schema.Struct({
	width: Schema.Int.pipe(Schema.between(1, 256)),
	height: Schema.Int.pipe(Schema.between(1, 256)),
	frames: Schema.Array(Schema.String).pipe(
		Schema.minItems(1),
		Schema.maxItems(50),
	),
});
/** Decode five seconds at ten frames/second. No playback, sound, Node or external URLs. */
export async function videoToGif(
	bytes: Uint8Array,
	signal: AbortSignal,
): Promise<Uint8Array> {
	const worker = new BrowserWindow({
		show: false,
		focusable: false,
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false,
		},
	});
	worker.webContents.setAudioMuted(true);
	const close = () => {
		if (!worker.isDestroyed()) worker.destroy();
	};
	signal.addEventListener("abort", close, { once: true });
	try {
		signal.throwIfAborted();
		await worker.loadURL(
			`data:text/html,${encodeURIComponent("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; media-src data:; script-src 'unsafe-eval'\"><body>")}`,
		);
		const result: unknown =
			await worker.webContents.executeJavaScript(`(async () => {
 const video = document.createElement('video'); video.muted = true; video.preload = 'auto';
 const wait = (event) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('video-timeout')), 8000); video.addEventListener(event, () => { clearTimeout(timer); resolve(); }, {once:true}); video.addEventListener('error', () => {clearTimeout(timer); reject(new Error('video-invalid'));}, {once:true}); });
 const loaded = wait('loadeddata'); video.src = ${JSON.stringify(`data:video/mp4;base64,${Buffer.from(bytes).toString("base64")}`)}; video.load(); await loaded;
 if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 10 || video.videoWidth * video.videoHeight > 64000000) throw new Error('video-bounds');
 const scale = Math.min(1, 256 / Math.max(video.videoWidth, video.videoHeight)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale)); const context = canvas.getContext('2d'); const frames = [];
 for (let t = 0; t < Math.min(5, video.duration) && frames.length < 50; t += 0.1) { if (Math.abs(video.currentTime-t)>0.001) {const seek = wait('seeked'); video.currentTime = t; await seek;} context.drawImage(video,0,0,canvas.width,canvas.height); const data = context.getImageData(0,0,canvas.width,canvas.height).data; let s = ''; for (const b of data) s += String.fromCharCode(b); frames.push(btoa(s)); }
 return {width:canvas.width,height:canvas.height,frames}; })()`);
		signal.throwIfAborted();
		const decoded = Schema.decodeUnknownSync(framesSchema)(result);
		const frames = decoded.frames.map((value) => {
			const rgba = new Uint8ClampedArray(Buffer.from(value, "base64"));
			if (rgba.length !== decoded.width * decoded.height * 4)
				throw new EmojiInvalid("The video could not be decoded.");
			return { rgba, delayMs: 100 };
		});
		return encodeGif({
			width: decoded.width,
			height: decoded.height,
			loopCount: 0,
			frames,
		});
	} finally {
		signal.removeEventListener("abort", close);
		close();
	}
}
