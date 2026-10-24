import { Writer } from "./bytes";
import { checkDimensions, GifError } from "./errors";
import { encodeLzw } from "./lzw";
import { quantize } from "./quantize";
import { GIF_LIMITS, type GifAnimation } from "./types";

export function encodeGif(animation: GifAnimation): Uint8Array {
	const { width, height, frames, loopCount } = animation;
	checkDimensions(width, height);
	if (frames.length < 1) throw new GifError("invalid");
	if (
		frames.length > GIF_LIMITS.maxFrames ||
		width * height * 4 * frames.length > GIF_LIMITS.maxDecodedBytes
	)
		throw new GifError("limit");
	if (
		loopCount !== null &&
		(!Number.isInteger(loopCount) || loopCount < 0 || loopCount > 65535)
	)
		throw new GifError("invalid");
	for (const frame of frames) {
		if (
			!(frame.rgba instanceof Uint8ClampedArray) ||
			frame.rgba.length !== width * height * 4 ||
			!Number.isInteger(frame.delayMs) ||
			frame.delayMs < 0 ||
			frame.delayMs > 655350 ||
			frame.delayMs % 10 !== 0
		) {
			throw new GifError("invalid");
		}
	}
	const writer = new Writer();
	writer.text("GIF89a");
	writer.u16(width);
	writer.u16(height);
	writer.write([0xf0, 0, 0, 0, 0, 0, 0, 0, 0]); // Two-entry global table, transparent background index zero.
	if (loopCount !== null) {
		writer.write([0x21, 0xff, 11]);
		writer.text("NETSCAPE2.0");
		writer.write([3, 1]);
		writer.u16(loopCount);
		writer.byte(0);
	}
	for (const frame of frames) {
		const { palette, indices } = quantize(frame.rgba);
		// Clear the full canvas after every frame, including opaque frames. A following
		// transparent pixel must not retain an unrelated previous frame's colour.
		writer.write([0x21, 0xf9, 4, 9]);
		writer.u16(frame.delayMs / 10);
		writer.write([0, 0, 0x2c]);
		writer.u16(0);
		writer.u16(0);
		writer.u16(width);
		writer.u16(height);
		writer.byte(0x87);
		writer.write(palette);
		encodeLzw(indices, writer);
	}
	writer.byte(0x3b);
	return writer.finish();
}
