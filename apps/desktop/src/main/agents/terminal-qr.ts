import { crc32, deflateSync } from "node:zlib";

function chunk(type: string, data: Buffer): Buffer {
	const name = Buffer.from(type, "ascii");
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
	return Buffer.concat([length, name, data, checksum]);
}

/** Rasterize already-encoded modules. This does not generate a new QR or handle its payload. */
function png(rows: readonly string[], size: number): string {
	const width = size + 8;
	const pixels = Buffer.alloc((width + 1) * width, 255);
	for (let y = 0; y < width; y++) {
		pixels[y * (width + 1)] = 0; // PNG filter: none
		for (let x = 0; x < size; x++) {
			const moduleY = y - 4 + 1; // recorded terminal has a one-module margin
			if (moduleY < 1 || moduleY > size) continue;
			const char = rows[Math.floor(moduleY / 2)]?.[x + 1];
			const dark = char === "█" || char === (moduleY % 2 === 0 ? "▀" : "▄");
			pixels[y * (width + 1) + x + 5] = dark ? 0 : 255;
		}
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(width, 4);
	header[8] = 8; // 8-bit grayscale
	return `data:image/png;base64,${Buffer.concat([
		Buffer.from("89504e470d0a1a0a", "hex"),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(pixels)),
		chunk("IEND", Buffer.alloc(0)),
	]).toString("base64")}`;
}

/** OpenClaw 3cd1240 src/media/qr-terminal.ts, small:true. Its own renderer
 * uses qrcode@1.5.4 modules, not qrcode-terminal or platform-dependent glyphs.
 * Versions 1..40 have size 21..177, one-module margins and a white final row.
 * The command runner decodes piped UTF-8 and removes CRLF before this parser.
 */
export function terminalQrDecoder(): (line: string) => string | undefined {
	let rows: string[] = [];
	const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[mJH]`, "g");
	return (raw) => {
		const line = raw.replace(ansi, "");
		if (
			!/^[ █▀▄]+$/.test(line) ||
			line.length < 23 ||
			line.length > 179 ||
			line.length % 4 !== 3
		) {
			rows = [];
			return;
		}
		if (rows[0]?.length !== line.length) rows = [];
		// The first half-row has a white top, and both side margins are white.
		if (!rows.length && !/^[ ▄]+$/.test(line)) return;
		if (line[0] !== " " || line.at(-1) !== " ") {
			rows = [];
			return;
		}
		rows.push(line);
		if (rows.length !== (line.length + 1) / 2) return;
		const complete = rows;
		rows = [];
		if (line.trim() !== "") return;
		return png(complete, line.length - 2);
	};
}
