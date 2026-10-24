import { Reader, type Writer } from "./bytes";
import { GifError } from "./errors";

class SubBlockBits {
	private readonly reader: Reader;
	private remaining = 0;
	private bits = 0;
	private buffer = 0;
	private ended = false;

	constructor(bytes: Uint8Array, start: number) {
		this.reader = new Reader(bytes);
		this.reader.position = start;
	}

	read(width: number): number {
		while (this.bits < width) {
			if (this.ended) throw new GifError("invalid");
			if (this.remaining === 0) {
				this.remaining = this.reader.byte();
				if (this.remaining === 0) {
					this.ended = true;
					throw new GifError("invalid");
				}
			}
			this.buffer |= this.reader.byte() << this.bits;
			this.bits += 8;
			this.remaining--;
		}
		const result = this.buffer & ((1 << width) - 1);
		this.buffer >>>= width;
		this.bits -= width;
		return result;
	}
}

export function decodeLzw(
	bytes: Uint8Array,
	start: number,
	minimum: number,
	count: number,
): Uint8Array {
	const input = new SubBlockBits(bytes, start);
	const output = new Uint8Array(count);
	const prefix = new Uint16Array(4096);
	const suffix = new Uint8Array(4096);
	const stack = new Uint8Array(4096);
	const clear = 1 << minimum;
	const end = clear + 1;
	let next = end + 1;
	let width = minimum + 1;
	let previous = -1;
	let first = 0;
	let written = 0;
	if (input.read(width) !== clear) throw new GifError("invalid");
	for (;;) {
		let code = input.read(width);
		if (code === clear) {
			next = end + 1;
			width = minimum + 1;
			previous = -1;
			continue;
		}
		if (code === end) {
			if (written !== count) throw new GifError("invalid");
			return output;
		}
		const current = code;
		let depth = 0;
		if (code === next && previous >= 0) {
			stack[depth++] = first;
			code = previous;
		} else if (code >= next) throw new GifError("invalid");
		while (code >= clear) {
			if (code >= next || depth >= 4095) throw new GifError("invalid");
			stack[depth++] = suffix[code] ?? 0;
			code = prefix[code] ?? 0;
		}
		first = code;
		stack[depth++] = first;
		if (written + depth > count) throw new GifError("invalid");
		while (depth > 0) output[written++] = stack[--depth] ?? 0;
		if (previous >= 0 && next < 4096) {
			prefix[next] = previous;
			suffix[next++] = first;
			if (next === 1 << width && width < 12) width++;
		}
		previous = current;
	}
}

/** A 256-colour local table, with 9..12-bit codes and dictionary clears. */
export function encodeLzw(indices: Uint8Array, output: Writer): void {
	output.byte(8);
	const block = new Uint8Array(255);
	let length = 0;
	let buffer = 0;
	let bits = 0;
	let width = 9;
	let next = 258;
	const dictionary = new Map<number, number>();
	const emitByte = (byte: number) => {
		block[length++] = byte;
		if (length === 255) {
			output.byte(length);
			output.write(block);
			length = 0;
		}
	};
	const emit = (code: number) => {
		buffer |= code << bits;
		bits += width;
		while (bits >= 8) {
			emitByte(buffer & 255);
			buffer >>>= 8;
			bits -= 8;
		}
	};
	let prefix = indices[0];
	if (prefix === undefined) throw new GifError("invalid");
	emit(256);
	for (let i = 1; i < indices.length; i++) {
		const value = indices[i] ?? 0;
		const key = prefix * 256 + value;
		const found = dictionary.get(key);
		if (found !== undefined) {
			prefix = found;
			continue;
		}
		emit(prefix);
		if (next < 4096) {
			dictionary.set(key, next++);
			// The decoder learns this entry one emitted code later.
			if (next > 1 << width && width < 12) width++;
		} else {
			emit(256);
			dictionary.clear();
			next = 258;
			width = 9;
		}
		prefix = value;
	}
	emit(prefix);
	if (next === 1 << width && width < 12) width++;
	emit(257);
	if (bits > 0) emitByte(buffer & 255);
	if (length > 0) {
		output.byte(length);
		output.write(block.subarray(0, length));
	}
	output.byte(0);
}
