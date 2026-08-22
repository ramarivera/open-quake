/**
 * QUAKE 0xA3 control-protocol framing primitives.
 *
 * Ground truth: .context/decokee-quake-fw/README.md + docs/PROTOCOL.md
 * (host -> device: `[0xA3, payloadLen+1, flag, ...payload, checksum]` where
 * `checksum = (flag + sum(payload)) % 0xFF`; device -> host checksum =
 * `(opCode + cmdID + sum(sub)) % 0xFF`).
 */

export const FRAME_HEADER = 0xa3 as const;

/** byte-sum mod 0xFF over the given bytes. */
export function checksum(bytes: ReadonlyArray<number>): number {
	let sum = 0;
	for (const b of bytes) {
		sum += b & 0xff;
	}
	return sum % 0xff;
}

/**
 * Frame a host -> device command:
 * `[0xA3, payloadLen+1, flag, ...payload, checksum]`.
 */
export function frameHostCommand(
	flag: number,
	payload: ReadonlyArray<number>,
): Uint8Array {
	const f = flag & 0xff;
	const body = payload.map((b) => b & 0xff);
	const frame = new Uint8Array(body.length + 4);
	frame[0] = FRAME_HEADER;
	frame[1] = body.length + 1;
	frame[2] = f;
	body.forEach((b, i) => {
		frame[3 + i] = b;
	});
	frame[frame.length - 1] = checksum([f, ...body]);
	return frame;
}

/**
 * Validate a device -> host report's trailing checksum:
 * `(opCode + cmdID + sum(sub)) % 0xFF` where the report is
 * `[0xA3, len, opCode, cmdID, ...sub, checksum]`.
 */
export function verifyDeviceReport(report: ReadonlyArray<number>): boolean {
	if (report.length < 5 || report[0] !== FRAME_HEADER) return false;
	const opCode = report[2];
	const cmdId = report[3];
	if (opCode === undefined || cmdId === undefined) return false;
	const sub = report.slice(4, -1);
	return report.at(-1) === checksum([opCode, cmdId, ...sub]);
}
