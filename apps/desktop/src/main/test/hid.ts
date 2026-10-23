import { checksum } from "@open-quake/protocol";

/** Independent incoming control report fixture, including the hardware padding. */
export function report(
	opcode: number,
	command: number,
	data: number[] = [],
): Uint8Array {
	const bytes = new Uint8Array(32);
	bytes.set([
		0xa3,
		data.length + 2,
		opcode,
		command,
		...data,
		checksum([opcode, command, ...data]),
	]);
	return bytes;
}
