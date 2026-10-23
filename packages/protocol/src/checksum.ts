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
	if (report.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255))
		return false;
	const bytes =
		report.length === 33 && report[0] === 0 ? report.slice(1) : report;
	if (bytes.length < 5 || bytes[0] !== FRAME_HEADER) return false;
	const length = bytes[1] ?? 0;
	if (length < 2) return false;
	const end = 2 + length;
	if (bytes.length < end + 1) return false;
	if (
		bytes.length !== end + 1 &&
		(bytes.length !== 32 || bytes.slice(end + 1).some((byte) => byte !== 0))
	)
		return false;
	return bytes[end] === checksum(bytes.slice(2, end));
}
