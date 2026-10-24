import { GifError } from "./errors";
import { GIF_LIMITS } from "./types";

export class Reader {
	position = 0;
	constructor(readonly bytes: Uint8Array) {}

	byte(): number {
		const value = this.bytes[this.position++];
		if (value === undefined) throw new GifError("invalid");
		return value;
	}

	u16(): number {
		return this.byte() | (this.byte() << 8);
	}

	take(length: number): Uint8Array {
		if (this.position + length > this.bytes.length)
			throw new GifError("invalid");
		const result = this.bytes.subarray(this.position, this.position + length);
		this.position += length;
		return result;
	}

	text(length: number): string {
		return String.fromCharCode(...this.take(length));
	}

	/** Validate sub-blocks without copying compressed data or allocating per block. */
	skipBlocks(): void {
		for (let length = this.byte(); length !== 0; length = this.byte()) {
			if (this.position + length > this.bytes.length)
				throw new GifError("invalid");
			this.position += length;
		}
	}
}

export class Writer {
	private bytes = new Uint8Array(1024);
	private length = 0;

	byte(value: number): void {
		if (this.length === GIF_LIMITS.maxBytes) throw new GifError("limit");
		if (this.length === this.bytes.length) {
			const next = new Uint8Array(
				Math.min(this.bytes.length * 2, GIF_LIMITS.maxBytes),
			);
			next.set(this.bytes);
			this.bytes = next;
		}
		this.bytes[this.length++] = value;
	}

	u16(value: number): void {
		this.byte(value & 255);
		this.byte(value >>> 8);
	}

	write(bytes: Iterable<number>): void {
		for (const value of bytes) this.byte(value);
	}

	text(value: string): void {
		for (let i = 0; i < value.length; i++) this.byte(value.charCodeAt(i));
	}

	finish(): Uint8Array {
		return this.bytes.slice(0, this.length);
	}
}
