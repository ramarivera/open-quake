/** Inspect dimensions before allowing a native decoder to allocate a raster. */
export function boundedCoverBytes(base64: string, mime: string): Buffer | null {
	if (
		!/^image\/(png|jpeg|webp)$/.test(mime) ||
		base64.length > 2_800_000 ||
		!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
	)
		return null;
	const bytes = Buffer.from(base64, "base64");
	let width = 0,
		height = 0;
	if (
		mime === "image/png" &&
		bytes.length >= 33 &&
		bytes
			.subarray(0, 8)
			.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
		bytes.toString("ascii", 12, 16) === "IHDR" &&
		bytes.readUInt32BE(8) === 13
	) {
		width = bytes.readUInt32BE(16);
		height = bytes.readUInt32BE(20);
	} else if (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
		let cursor = 2;
		while (cursor + 4 <= bytes.length) {
			if (bytes[cursor++] !== 255) return null;
			while (bytes[cursor] === 255) cursor++;
			const marker = bytes[cursor++];
			if (marker === 218 || marker === 217 || marker === undefined) return null;
			if (cursor + 2 > bytes.length) return null;
			const length = bytes.readUInt16BE(cursor);
			if (length < 2 || cursor + length > bytes.length) return null;
			if (
				[
					192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
				].includes(marker)
			) {
				if (length < 8) return null;
				height = bytes.readUInt16BE(cursor + 3);
				width = bytes.readUInt16BE(cursor + 5);
				break;
			}
			cursor += length;
		}
	} else if (
		mime === "image/webp" &&
		bytes.length >= 30 &&
		bytes.toString("ascii", 0, 4) === "RIFF" &&
		bytes.toString("ascii", 8, 12) === "WEBP"
	) {
		const kind = bytes.toString("ascii", 12, 16);
		if (kind === "VP8X") {
			width = bytes.readUIntLE(24, 3) + 1;
			height = bytes.readUIntLE(27, 3) + 1;
		} else if (
			kind === "VP8 " &&
			bytes.subarray(23, 26).equals(Buffer.from([157, 1, 42]))
		) {
			width = bytes.readUInt16LE(26) & 16383;
			height = bytes.readUInt16LE(28) & 16383;
		} else if (kind === "VP8L" && bytes[20] === 47) {
			const bits = bytes.readUInt32LE(21);
			width = (bits & 16383) + 1;
			height = ((bits >>> 14) & 16383) + 1;
		}
	}
	return width > 0 && height > 0 && width * height <= 16_000_000 ? bytes : null;
}
