import {
	decodeGif,
	encodeGif,
	GIF_LIMITS,
	GifError,
} from "../../../../shared/gif";

export type CaptionPosition = "top" | "mid" | "bot";
export interface CaptionSettings {
	readonly text: string;
	readonly size?: number;
	/** Exactly 0xRRGGBBAA, including alpha. */
	readonly color?: string;
	readonly position?: CaptionPosition;
}

export function captionTextWeight(text: string): number {
	let weight = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		weight += code >= 0x4e00 && code <= 0x9fa5 ? 2 : 1;
	}
	return weight;
}

function validateSettings(settings: CaptionSettings) {
	const size = settings.size ?? 48;
	const color = settings.color ?? "0xffffffff";
	const position = settings.position ?? "bot";
	if (
		typeof settings.text !== "string" ||
		settings.text.length > 50 ||
		captionTextWeight(settings.text) > 50 ||
		!Number.isInteger(size) ||
		size < 12 ||
		size > 100 ||
		!/^0x[\da-f]{8}$/i.test(color) ||
		!["top", "mid", "bot"].includes(position)
	) {
		throw new GifError("settings");
	}
	const r = Number.parseInt(color.slice(2, 4), 16);
	const g = Number.parseInt(color.slice(4, 6), 16);
	const b = Number.parseInt(color.slice(6, 8), 16);
	const a = Number.parseInt(color.slice(8, 10), 16) / 255;
	return {
		text: settings.text,
		size,
		color: `rgba(${r}, ${g}, ${b}, ${a})`,
		position,
	};
}

function makeCanvas(width: number, height: number) {
	if (typeof document === "undefined") throw new GifError("canvas");
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (context === null) throw new GifError("canvas");
	return { canvas, context };
}

/** Always pass the original motion source. Every call decodes it afresh; no rendered
 * frames or canvas state survive a call, so caption edits cannot accumulate.
 */
export async function captionGif(
	bytes: Uint8Array,
	settings: CaptionSettings,
): Promise<Uint8Array> {
	const options = validateSettings(settings);
	const animation = decodeGif(bytes);
	if (options.text.length === 0) return bytes.slice();
	try {
		const { context } = makeCanvas(animation.width, animation.height);
		await document.fonts?.ready;
		const image = context.createImageData(animation.width, animation.height);
		const padding = Math.min(
			options.size / 8,
			animation.width / 4,
			animation.height / 4,
		);
		context.font = `800 ${options.size}px sans-serif`;
		context.textAlign = "center";
		context.textBaseline =
			options.position === "top"
				? "top"
				: options.position === "mid"
					? "middle"
					: "bottom";
		context.lineJoin = "round";
		context.lineWidth = Math.max(2, options.size / 12);
		context.strokeStyle = "rgba(0, 0, 0, 0.85)";
		context.fillStyle = options.color;
		const y =
			options.position === "top"
				? padding
				: options.position === "mid"
					? animation.height / 2
					: animation.height - padding;
		const text = options.text.replace(/[\r\n]/g, " ");
		for (const frame of animation.frames) {
			image.data.set(frame.rgba);
			context.putImageData(image, 0, 0);
			context.strokeText(
				text,
				animation.width / 2,
				y,
				animation.width - padding * 2,
			);
			context.fillText(
				text,
				animation.width / 2,
				y,
				animation.width - padding * 2,
			);
			frame.rgba.set(
				context.getImageData(0, 0, animation.width, animation.height).data,
			);
		}
		return encodeGif(animation);
	} catch (cause) {
		if (cause instanceof GifError) throw cause;
		throw new GifError("canvas", cause);
	}
}

function u32(bytes: Uint8Array, at: number): number {
	return (
		(bytes[at] ?? 0) * 0x1000000 +
		((bytes[at + 1] ?? 0) << 16) +
		((bytes[at + 2] ?? 0) << 8) +
		(bytes[at + 3] ?? 0)
	);
}

/** Read dimensions before the browser is allowed to allocate decoded pixels. */
function stillDimensions(
	bytes: Uint8Array,
	mime: string,
): { width: number; height: number } {
	if (mime === "png") {
		const signature = [137, 80, 78, 71, 13, 10, 26, 10];
		if (
			bytes.length < 33 ||
			!signature.every((value, at) => value === bytes[at]) ||
			u32(bytes, 8) !== 13 ||
			String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR"
		)
			throw new GifError("image");
		return { width: u32(bytes, 16), height: u32(bytes, 20) };
	}
	if (bytes[0] !== 255 || bytes[1] !== 216) throw new GifError("image");
	let at = 2;
	while (at < bytes.length) {
		if (bytes[at++] !== 255) throw new GifError("image");
		while (bytes[at] === 255) at++;
		const marker = bytes[at++];
		if (marker === undefined || marker === 0xda || marker === 0xd9) break;
		if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
		const length = ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
		if (length < 2 || at + length > bytes.length) throw new GifError("image");
		if (
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc
		) {
			if (length < 8) throw new GifError("image");
			return {
				width: ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0),
				height: ((bytes[at + 3] ?? 0) << 8) | (bytes[at + 4] ?? 0),
			};
		}
		at += length;
	}
	throw new GifError("image");
}

/** Local PNG/JPEG only, with GIF's 1024x1024 canvas limit. No URL fetches. */
export async function stillImageGif(
	sourceDataUrl: string,
): Promise<Uint8Array> {
	if (sourceDataUrl.length > Math.ceil(GIF_LIMITS.maxBytes / 3) * 4 + 32)
		throw new GifError("limit");
	const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})$/.exec(
		sourceDataUrl,
	);
	const mime = match?.[1];
	const base64 = match?.[2];
	if (mime === undefined || base64 === undefined || base64.length % 4 !== 0)
		throw new GifError("image");
	if (
		(base64.length / 4) * 3 -
			(base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0) >
		GIF_LIMITS.maxBytes
	)
		throw new GifError("limit");
	let bytes: Uint8Array;
	try {
		bytes = Uint8Array.from(atob(base64), (character) =>
			character.charCodeAt(0),
		);
	} catch (cause) {
		throw new GifError("image", cause);
	}
	const { width, height } = stillDimensions(bytes, mime);
	if (width < 1 || height < 1) throw new GifError("image");
	if (width > GIF_LIMITS.maxWidth || height > GIF_LIMITS.maxHeight)
		throw new GifError("limit");
	try {
		if (typeof Image === "undefined") throw new GifError("canvas");
		const image = new Image();
		image.src = sourceDataUrl;
		await image.decode();
		if (image.naturalWidth !== width || image.naturalHeight !== height)
			throw new GifError("image");
		const { context } = makeCanvas(width, height);
		context.drawImage(image, 0, 0);
		return encodeGif({
			width,
			height,
			loopCount: null,
			frames: [
				{ rgba: context.getImageData(0, 0, width, height).data, delayMs: 0 },
			],
		});
	} catch (cause) {
		if (cause instanceof GifError) throw cause;
		throw new GifError("image", cause);
	}
}
