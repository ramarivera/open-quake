import { inflateRawSync } from "node:zlib";

export const ZIP_LIMITS = {
	archive: 32 * 1024 * 1024,
	expanded: 64 * 1024 * 1024,
	entry: 5 * 1024 * 1024,
	entries: 10000,
} as const;
const crc = (bytes: Uint8Array): number => {
	let n = 0xffffffff;
	for (const byte of bytes) {
		n ^= byte;
		for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
	}
	return (n ^ 0xffffffff) >>> 0;
};
/** Read bounded ZIP entries in memory. No archive path ever reaches filesystem IO. */
export function readIconZip(bytes: Buffer): ReadonlyMap<string, Buffer> {
	const invalid = (): never => {
		throw new Error("Invalid icon pack");
	};
	if (bytes.length > ZIP_LIMITS.archive || bytes.length < 22) return invalid();
	let end = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
		if (
			bytes.readUInt32LE(i) === 0x06054b50 &&
			i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
		) {
			end = i;
			break;
		}
	if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
		return invalid();
	const count = bytes.readUInt16LE(end + 10),
		offset = bytes.readUInt32LE(end + 16),
		size = bytes.readUInt32LE(end + 12);
	if (
		!count ||
		count > ZIP_LIMITS.entries ||
		bytes.readUInt16LE(end + 8) !== count ||
		offset + size !== end
	)
		return invalid();
	const entries = new Map<string, Buffer>();
	let pos = offset,
		total = 0;
	for (let i = 0; i < count; i++) {
		if (pos + 46 > end || bytes.readUInt32LE(pos) !== 0x02014b50)
			return invalid();
		const flags = bytes.readUInt16LE(pos + 8),
			method = bytes.readUInt16LE(pos + 10);
		const checksum = bytes.readUInt32LE(pos + 16),
			compressed = bytes.readUInt32LE(pos + 20),
			expanded = bytes.readUInt32LE(pos + 24);
		const nameLength = bytes.readUInt16LE(pos + 28),
			extra = bytes.readUInt16LE(pos + 30),
			comment = bytes.readUInt16LE(pos + 32);
		const mode = bytes.readUInt32LE(pos + 38) >>> 16,
			local = bytes.readUInt32LE(pos + 42);
		if (pos + 46 + nameLength + extra + comment > end) return invalid();
		const name = bytes
			.subarray(pos + 46, pos + 46 + nameLength)
			.toString("utf8");
		pos += 46 + nameLength + extra + comment;
		if (
			!name ||
			name.includes("\0") ||
			name.includes("\\") ||
			name.startsWith("/") ||
			/^[a-z]:/i.test(name) ||
			name.split("/").some((p) => p === ".." || p === ".") ||
			(mode & 0xf000) === 0xa000 ||
			flags & 1 ||
			![0, 8].includes(method)
		)
			return invalid();
		total += expanded;
		if (
			expanded > ZIP_LIMITS.entry ||
			total > ZIP_LIMITS.expanded ||
			local + 30 > offset ||
			bytes.readUInt32LE(local) !== 0x04034b50
		)
			return invalid();
		const localNameLength = bytes.readUInt16LE(local + 26),
			localExtra = bytes.readUInt16LE(local + 28);
		const data = local + 30 + localNameLength + localExtra;
		if (
			data + compressed > offset ||
			bytes.readUInt16LE(local + 8) !== method ||
			bytes
				.subarray(local + 30, local + 30 + localNameLength)
				.toString("utf8") !== name ||
			entries.has(name)
		)
			return invalid();
		const source = bytes.subarray(data, data + compressed);
		const decoded =
			method === 0
				? source
				: inflateRawSync(source, { maxOutputLength: ZIP_LIMITS.entry });
		if (decoded.length !== expanded || crc(decoded) !== checksum)
			return invalid();
		if (!name.endsWith("/")) entries.set(name, decoded);
	}
	if (pos !== end) return invalid();
	return entries;
}
