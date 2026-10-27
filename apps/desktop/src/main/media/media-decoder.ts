import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import { BrowserWindow, nativeImage } from "electron";
import { DESKTOP_RESOURCE_LIMIT, MediaUnreadable } from "../../shared/display";
import { type DecodedImage, ImageDecoder } from "./image-decoder";

interface DecodedVideo {
	readonly format:
		| "video/mp4"
		| "video/quicktime"
		| "video/webm"
		| "video/x-matroska"
		| "video/x-msvideo";
	readonly width: number;
	readonly height: number;
	readonly durationMs: number;
	readonly dataUrl: string;
}
export type DecodedMedia =
	| DecodedImage
	| DecodedVideo
	| {
			readonly format: "image/gif";
			readonly width: number;
			readonly height: number;
			readonly dataUrl: string;
	  };
export class MediaDecoder extends Effect.Service<MediaDecoder>()(
	"MediaDecoder",
	{
		dependencies: [ImageDecoder.Default],
		effect: Effect.gen(function* () {
			const images = yield* ImageDecoder;
			// Retain metadata only, never the up-to-11 MiB data URL. Serialize misses
			// so concurrent reads/imports of identical content share one native probe.
			const metadata = new Map<string, Omit<DecodedVideo, "dataUrl">>();
			const probeLock = yield* Effect.makeSemaphore(1);
			const video = Effect.fn("MediaDecoder.video")(function* (
				bytes: Buffer,
				format: DecodedVideo["format"],
			) {
				if (!bytes.length || bytes.length > DESKTOP_RESOURCE_LIMIT)
					return yield* new MediaUnreadable(undefined);
				const hash = createHash("sha256").update(bytes).digest("hex");
				const ready = metadata.get(hash);
				if (ready) {
					metadata.delete(hash);
					metadata.set(hash, ready);
					return {
						...ready,
						dataUrl: `data:${ready.format};base64,${bytes.toString("base64")}`,
					};
				}
				return yield* probeLock.withPermits(1)(
					Effect.gen(function* () {
						let cached = metadata.get(hash);
						if (!cached) {
							const decoded = yield* Effect.tryPromise({
								try: (signal) => probeVideo(bytes, format, signal),
								catch: (cause) => new MediaUnreadable(cause),
							});
							cached = {
								format: decoded.format,
								width: decoded.width,
								height: decoded.height,
								durationMs: decoded.durationMs,
							};
						}
						metadata.delete(hash);
						metadata.set(hash, cached);
						if (metadata.size > 256) {
							const oldest = metadata.keys().next().value;
							if (oldest !== undefined) metadata.delete(oldest);
						}
						return {
							...cached,
							dataUrl: `data:${cached.format};base64,${bytes.toString("base64")}`,
						};
					}),
				);
			});
			return {
				decode: Effect.fn("MediaDecoder.decode")(
					(bytes: Buffer): Effect.Effect<DecodedMedia, MediaUnreadable> => {
						if (
							bytes.length >= 13 &&
							/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))
						)
							return Effect.try({
								try: () => {
									if (bytes.length > DESKTOP_RESOURCE_LIMIT)
										throw new RangeError();
									const image = nativeImage.createFromBuffer(bytes);
									const { width, height } = image.getSize();
									if (
										image.isEmpty() ||
										width <= 0 ||
										height <= 0 ||
										width * height > 64_000_000
									)
										throw new RangeError();
									return {
										format: "image/gif" as const,
										width,
										height,
										dataUrl: `data:image/gif;base64,${bytes.toString("base64")}`,
									};
								},
								catch: (cause) => new MediaUnreadable(cause),
							});
						const format = videoFormat(bytes);
						return format ? video(bytes, format) : images.decode(bytes);
					},
				),
			};
		}),
	},
) {}
function videoFormat(
	bytes: Buffer,
):
	| "video/mp4"
	| "video/quicktime"
	| "video/webm"
	| "video/x-matroska"
	| "video/x-msvideo"
	| undefined {
	if (bytes.subarray(4, 8).toString("ascii") === "ftyp")
		return bytes.subarray(8, 12).toString("ascii") === "qt  "
			? "video/quicktime"
			: "video/mp4";
	if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))
		return bytes.subarray(0, 256).includes(Buffer.from("matroska"))
			? "video/x-matroska"
			: "video/webm";
	if (
		bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
		bytes.subarray(8, 12).toString("ascii") === "AVI "
	)
		return "video/x-msvideo";
}
/** Metadata only. This worker is hidden, never plays, and cannot emit sound. */
async function probeVideo(
	bytes: Buffer,
	format:
		| "video/mp4"
		| "video/webm"
		| "video/quicktime"
		| "video/x-matroska"
		| "video/x-msvideo",
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
