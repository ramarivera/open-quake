import { Either } from "effect";

export interface Uf2Info {
	readonly blocks: number;
	readonly payloadBytes: number;
	readonly start: number;
	readonly end: number;
	readonly family: number;
}
export type Uf2Invalid =
	| "size"
	| "magic"
	| "flags"
	| "family"
	| "block"
	| "payload"
	| "overlap"
	| "range";

/** Structural inspection only. A trusted fingerprint/board descriptor must authorize writing. */
export function inspectUf2(
	bytes: Uint8Array,
): Either.Either<Uf2Info, Uf2Invalid> {
	if (!bytes.length || bytes.length % 512 || bytes.length > 16 * 1024 * 1024)
		return Either.left("size");
	const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = bytes.length / 512;
	const numbers = new Set<number>();
	const ranges: { start: number; end: number }[] = [];
	let payloadBytes = 0;
	for (let offset = 0; offset < bytes.length; offset += 512) {
		const read = (n: number) => data.getUint32(offset + n, true);
		if (
			read(0) !== 0x0a324655 ||
			read(4) !== 0x9e5d5157 ||
			read(508) !== 0x0ab16f30
		)
			return Either.left("magic");
		if (read(8) !== 0x2000) return Either.left("flags");
		if (read(28) !== 0x1aa143c7) return Either.left("family");
		const number = read(20);
		if (read(24) !== count || number >= count || numbers.has(number))
			return Either.left("block");
		numbers.add(number);
		const size = read(16);
		const start = read(12);
		if (!size || size > 476 || size % 4 || start % 4)
			return Either.left("payload");
		const end = start + size - 1;
		if (end > 0xffffffff) return Either.left("range");
		ranges.push({ start, end });
		payloadBytes += size;
	}
	ranges.sort((a, b) => a.start - b.start);
	for (let i = 1; i < ranges.length; i++) {
		const previous = ranges[i - 1];
		const next = ranges[i];
		if (previous && next && next.start <= previous.end)
			return Either.left("overlap");
	}
	return Either.right({
		blocks: count,
		payloadBytes,
		start: ranges[0]?.start ?? 0,
		end: ranges.at(-1)?.end ?? 0,
		family: 0x1aa143c7,
	});
}
