import { Reader } from "./bytes";
import { checkDimensions, GifError } from "./errors";
import { decodeLzw } from "./lzw";
import { GIF_LIMITS, type GifAnimation, type GifFrame } from "./types";

interface Control {
	delayMs: number;
	disposal: number;
	transparent: number | null;
}
interface Image extends Control {
	x: number;
	y: number;
	width: number;
	height: number;
	interlaced: boolean;
	palette: Uint8Array;
	minimum: number;
	start: number;
}
const noControl = (): Control => ({
	delayMs: 0,
	disposal: 0,
	transparent: null,
});

function readControl(reader: Reader): Control {
	if (reader.byte() !== 4) throw new GifError("invalid");
	const flags = reader.byte();
	const delayMs = reader.u16() * 10;
	const transparent = reader.byte();
	if (reader.byte() !== 0 || (flags & 0xe0) !== 0)
		throw new GifError("invalid");
	if ((flags & 2) !== 0 || ((flags >> 2) & 7) > 3)
		throw new GifError("unsupported");
	return {
		delayMs,
		disposal: (flags >> 2) & 7,
		transparent: flags & 1 ? transparent : null,
	};
}

function readApplication(reader: Reader): number | undefined {
	if (reader.byte() !== 11) throw new GifError("invalid");
	const name = reader.text(11);
	if (name !== "NETSCAPE2.0" && name !== "ANIMEXTS1.0") {
		reader.skipBlocks();
		return undefined;
	}
	if (reader.byte() !== 3 || reader.byte() !== 1) throw new GifError("invalid");
	const loops = reader.u16();
	if (reader.byte() !== 0) throw new GifError("invalid");
	return loops;
}

/** Structural preflight counts all canvases before allocating even the first RGBA frame. */
function parse(bytes: Uint8Array) {
	if (bytes.byteLength > GIF_LIMITS.maxBytes) throw new GifError("limit");
	const reader = new Reader(bytes);
	const signature = reader.text(6);
	if (signature !== "GIF87a" && signature !== "GIF89a")
		throw new GifError("invalid");
	const width = reader.u16();
	const height = reader.u16();
	checkDimensions(width, height);
	const flags = reader.byte();
	const background = reader.byte();
	reader.byte(); // Pixel aspect ratio does not change the logical canvas.
	const global =
		flags & 128 ? reader.take(3 * (2 << (flags & 7))) : new Uint8Array(0);
	if (global.length > 0 && background >= global.length / 3)
		throw new GifError("invalid");
	const images: Image[] = [];
	let control = noControl();
	let loopCount: number | null = null;
	for (;;) {
		const marker = reader.byte();
		if (marker === 0x3b) break;
		if (marker === 0x21) {
			const extension = reader.byte();
			if (extension === 0xf9) control = readControl(reader);
			else if (extension === 0xff)
				loopCount = readApplication(reader) ?? loopCount;
			else if (extension === 1)
				throw new GifError("unsupported"); // Plain-text graphics need an undefined font.
			else reader.skipBlocks();
			continue;
		}
		if (marker !== 0x2c) throw new GifError("invalid");
		if (
			images.length === GIF_LIMITS.maxFrames ||
			(images.length + 1) * width * height * 4 > GIF_LIMITS.maxDecodedBytes
		) {
			throw new GifError("limit");
		}
		const x = reader.u16();
		const y = reader.u16();
		const frameWidth = reader.u16();
		const frameHeight = reader.u16();
		if (
			frameWidth === 0 ||
			frameHeight === 0 ||
			x + frameWidth > width ||
			y + frameHeight > height
		) {
			throw new GifError("invalid");
		}
		const imageFlags = reader.byte();
		if (imageFlags & 0x18) throw new GifError("invalid");
		const palette =
			imageFlags & 128 ? reader.take(3 * (2 << (imageFlags & 7))) : global;
		if (
			palette.length === 0 ||
			(control.transparent !== null &&
				control.transparent >= palette.length / 3)
		) {
			throw new GifError("invalid");
		}
		const minimum = reader.byte();
		if (minimum < 2 || minimum > 8) throw new GifError("invalid");
		const start = reader.position;
		reader.skipBlocks();
		images.push({
			...control,
			x,
			y,
			width: frameWidth,
			height: frameHeight,
			palette,
			minimum,
			start,
			interlaced: !!(imageFlags & 64),
		});
		control = noControl();
	}
	if (images.length === 0 || reader.position !== bytes.length)
		throw new GifError("invalid");
	return { width, height, images, loopCount };
}

function clearRectangle(
	canvas: Uint8ClampedArray,
	canvasWidth: number,
	image: Image,
): void {
	// Browser GIF compositing clears to transparent, including opaque source frames.
	for (let y = image.y; y < image.y + image.height; y++) {
		const at = (y * canvasWidth + image.x) * 4;
		canvas.fill(0, at, at + image.width * 4);
	}
}

function composite(
	canvas: Uint8ClampedArray,
	canvasWidth: number,
	image: Image,
	indices: Uint8Array,
): void {
	let source = 0;
	const row = (y: number) => {
		for (let x = 0; x < image.width; x++) {
			const index = indices[source++];
			if (index === undefined || index >= image.palette.length / 3)
				throw new GifError("invalid");
			if (index === image.transparent) continue;
			const target = ((image.y + y) * canvasWidth + image.x + x) * 4;
			canvas[target] = image.palette[index * 3] ?? 0;
			canvas[target + 1] = image.palette[index * 3 + 1] ?? 0;
			canvas[target + 2] = image.palette[index * 3 + 2] ?? 0;
			canvas[target + 3] = 255;
		}
	};
	if (image.interlaced) {
		for (const [start, step] of [
			[0, 8],
			[4, 8],
			[2, 4],
			[1, 2],
		]) {
			if (start === undefined || step === undefined)
				throw new GifError("invalid");
			for (let y = start; y < image.height; y += step) row(y);
		}
	} else for (let y = 0; y < image.height; y++) row(y);
}

export function decodeGif(bytes: Uint8Array): GifAnimation {
	const parsed = parse(bytes);
	const { width, height } = parsed;
	let canvas = new Uint8ClampedArray(width * height * 4);
	const frames: GifFrame[] = [];
	for (const image of parsed.images) {
		const previous = image.disposal === 3 ? canvas.slice() : undefined;
		const indices = decodeLzw(
			bytes,
			image.start,
			image.minimum,
			image.width * image.height,
		);
		composite(canvas, width, image, indices);
		frames.push({ rgba: canvas.slice(), delayMs: image.delayMs });
		if (image.disposal === 2) clearRectangle(canvas, width, image);
		else if (previous !== undefined) canvas = previous;
	}
	return { width, height, frames, loopCount: parsed.loopCount };
}
