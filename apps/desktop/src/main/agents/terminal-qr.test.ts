import { expect, it } from "vitest";
import recording from "./__fixtures__/whatsapp-terminal-qr.json";
import { terminalQrDecoder } from "./terminal-qr";

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
