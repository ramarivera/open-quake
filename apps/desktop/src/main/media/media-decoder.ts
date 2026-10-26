import { Effect, Schema } from "effect";
import { BrowserWindow } from "electron";
import { DESKTOP_RESOURCE_LIMIT, MediaUnreadable } from "../../shared/display";
import { type DecodedImage, ImageDecoder } from "./image-decoder";

interface DecodedVideo {
	readonly format: "video/mp4" | "video/quicktime" | "video/webm";
	readonly width: number;
	readonly height: number;
	readonly durationMs: number;
	readonly dataUrl: string;
}
export type DecodedMedia = DecodedImage | DecodedVideo;
export class MediaDecoder extends Effect.Service<MediaDecoder>()(
	"MediaDecoder",
	{
		dependencies: [ImageDecoder.Default],
		effect: Effect.gen(function* () {
			const images = yield* ImageDecoder;
			return {
				decode: Effect.fn("MediaDecoder.decode")(
					(bytes: Buffer): Effect.Effect<DecodedMedia, MediaUnreadable> => {
						const format = videoFormat(bytes);
						return format
							? Effect.tryPromise({
									try: (signal) => {
										if (!bytes.length || bytes.length > DESKTOP_RESOURCE_LIMIT)
											throw new MediaUnreadable(undefined);
										return probeVideo(bytes, format, signal);
									},
									catch: (cause) => new MediaUnreadable(cause),
								})
							: images.decode(bytes);
					},
				),
			};
		}),
	},
) {}
function videoFormat(
	bytes: Buffer,
): "video/mp4" | "video/quicktime" | "video/webm" | undefined {
	if (bytes.subarray(4, 8).toString("ascii") === "ftyp")
		return bytes.subarray(8, 12).toString("ascii") === "qt  "
			? "video/quicktime"
			: "video/mp4";
	if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))
		return "video/webm";
}
/** Metadata only. This worker is hidden, never plays, and cannot emit sound. */
async function probeVideo(
	bytes: Buffer,
	format: "video/mp4" | "video/webm" | "video/quicktime",
	signal: AbortSignal,
): Promise<DecodedVideo> {
	const window = new BrowserWindow({
		show: false,
		focusable: false,
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false,
		},
	});
	window.webContents.setAudioMuted(true);
	const close = () => {
		if (!window.isDestroyed()) window.destroy();
	};
	const dataUrl = `data:${format};base64,${bytes.toString("base64")}`;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let abort = () => {};
	const deadline = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new MediaUnreadable(undefined)), 8000);
		abort = () => reject(new MediaUnreadable(undefined));
	});
	signal.addEventListener("abort", abort, { once: true });
	try {
		return await Promise.race([
			deadline,
			(async () => {
				if (signal.aborted) throw new MediaUnreadable(undefined);
				await window.loadURL(
					`data:text/html,${encodeURIComponent("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; media-src data:; script-src 'unsafe-eval'\"><body>")}`,
				);
				const metadata: unknown =
					await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
   const video = document.createElement('video'); video.muted = true; video.preload = 'metadata';
   const timeout = setTimeout(() => reject(new Error('metadata-timeout')), 6000);
   video.onloadedmetadata = () => { clearTimeout(timeout); resolve({ width: video.videoWidth, height: video.videoHeight, durationMs: video.duration * 1000 }); };
   video.onerror = () => { clearTimeout(timeout); reject(new Error('video-unreadable')); };
   video.src = ${JSON.stringify(dataUrl)}; document.body.appendChild(video); video.load();
  })`);
				const decoded = Schema.decodeUnknownSync(
					Schema.Struct({
						width: Schema.Int.pipe(Schema.positive()),
						height: Schema.Int.pipe(Schema.positive()),
						durationMs: Schema.Finite.pipe(Schema.greaterThanOrEqualTo(2000)),
					}),
				)(metadata);
				if (decoded.width * decoded.height > 64_000_000)
					throw new MediaUnreadable(undefined);
				return { ...decoded, format, dataUrl };
			})(),
		]);
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", abort);
		close();
	}
}
