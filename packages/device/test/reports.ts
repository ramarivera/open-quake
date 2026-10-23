import { checksum, FRAME_HEADER } from "@open-quake/protocol";

/** Known incoming format, independent of the device adapter. */
export function report(
	opcode: number,
	command: number,
	data: ReadonlyArray<number> = [],
	withReportId = false,
): Uint8Array {
	const bytes = new Uint8Array(withReportId ? 33 : 32);
	bytes.set(
		[
			FRAME_HEADER,
			data.length + 2,
			opcode,
			command,
			...data,
			checksum([opcode, command, ...data]),
		],
		withReportId ? 1 : 0,
	);
	return bytes;
}
