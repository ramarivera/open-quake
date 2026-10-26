import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { expect, it } from "vitest";
import recording from "./__fixtures__/whatsapp-terminal-qr.json";
import versions from "./__fixtures__/whatsapp-terminal-qr-versions.json";
import { terminalQrDecoder } from "./terminal-qr";

// Recorded from the unmodified pinned renderer, with qrcode@1.5.4 choosing
// each version automatically. Compressed only to keep test fixture size small.
for (const variant of [
	"ANSI LF",
	"plain LF",
	"refresh ANSI CRLF",
	"plain CRLF",
]) {
	it.each(versions.cases)(
		`4381279720 ${variant} decodes QR version $version exactly`,
		({ terminalDeflateBase64, size, modulesSha256 }) => {
			let output = inflateSync(
				Buffer.from(terminalDeflateBase64, "base64"),
			).toString("utf8");
			if (variant.startsWith("plain"))
				output = output.replace(
					new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
					"",
				);
			if (variant.startsWith("refresh"))
				output = `${String.fromCharCode(27)}[2J${String.fromCharCode(27)}[H${output}`;
			if (variant.endsWith("CRLF")) output = output.replaceAll("\n", "\r\n");
			const decode = terminalQrDecoder();
			const images = output
				.split(/\r?\n/)
				.map(decode)
				.filter((value) => value !== undefined);
			expect(images).toHaveLength(1);
			const png = Buffer.from(images[0]?.split(",")[1] ?? "", "base64");
			const width = size + 8;
			expect(png.readUInt32BE(16)).toBe(width);
			expect(png.readUInt32BE(20)).toBe(width);
			const pixels = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)));
			const modules = Buffer.alloc(size * size);
			let whiteMargin = true;
			for (let y = 0; y < width; y++) {
				expect(pixels[y * (width + 1)]).toBe(0);
				for (let x = 0; x < width; x++) {
					const pixel = pixels[y * (width + 1) + x + 1];
					if (x < 4 || y < 4 || x >= width - 4 || y >= width - 4)
						whiteMargin &&= pixel === 255;
					else modules[(y - 4) * size + x - 4] = pixel === 0 ? 1 : 0;
				}
			}
			expect(whiteMargin).toBe(true);
			expect(createHash("sha256").update(modules).digest("hex")).toBe(
				modulesSha256,
			);
		},
	);
}

it("CENTER-078 refresh replaces a recorded QR, including clear-screen ANSI prefixes", () => {
	const decode = terminalQrDecoder();
	const lines = recording.output.split("\n");
	const first = lines.map(decode).filter(Boolean);
	const second = lines
		.map((line) =>
			decode(
				`${String.fromCharCode(27)}[2J${String.fromCharCode(27)}[H${line}`,
			),
		)
		.filter(Boolean);
	expect(first).toHaveLength(1);
	expect(second).toEqual(first);
});

it("CENTER-078 rejects interrupted, oversized and malformed terminal blocks and recovers on refresh", () => {
	const decode = terminalQrDecoder();
	const lines = recording.output.split("\n");
	for (const line of lines.slice(0, 4)) expect(decode(line)).toBeUndefined();
	expect(decode("unrelated message")).toBeUndefined();
	for (const line of lines.slice(4)) expect(decode(line)).toBeUndefined();
	for (const line of [
		"▄".repeat(10000),
		" ".repeat(23),
		" █▄ unexpected ",
		"▄".repeat(23),
	])
		expect(decode(line)).toBeUndefined();
	expect(lines.map(decode).filter(Boolean)).toHaveLength(1);
});
