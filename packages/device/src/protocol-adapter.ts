/** Temporary byte adapter. Replace with L1 codecs without changing the conductor. */
import {
	FRAME_HEADER,
	frameHostCommand,
	verifyDeviceReport,
} from "@open-quake/protocol";
import { Either, Option } from "effect";
import type { DeviceEvent } from "./device-contracts.js";
import { QuakeReportInvalid } from "./device-errors.js";

export const keepAliveFrame = (): Uint8Array => frameHostCommand(2, [0xef]);
export const keepAliveReport = (): Uint8Array => {
	const report = new Uint8Array(33);
	report.set(keepAliveFrame(), 1);
	return report;
};

export function decodeReport(
	input: Uint8Array,
): Either.Either<Option.Option<DeviceEvent>, QuakeReportInvalid> {
	const bytes =
		input[0] === 0 && input[1] === FRAME_HEADER ? input.subarray(1) : input;
	if (bytes[0] !== FRAME_HEADER) return Either.right(Option.none());
	const length = bytes[1] ?? 0;
	// The recovered host parser counts body bytes, excluding header/length/checksum.
	const frame = Array.from(bytes.subarray(0, length + 3));
	if (
		length < 2 ||
		length > 29 ||
		frame.length !== length + 3 ||
		!verifyDeviceReport(frame)
	) {
		return Either.left(new QuakeReportInvalid());
	}
	const opcode = frame[2];
	const command = frame[3];
	const sub = frame.slice(4, -1);
	const value = sub[0];
	if (opcode === 3 && (command === 1 || command === 2)) {
		if (value === undefined) return Either.left(new QuakeReportInvalid());
		return Either.right(
			Option.some(
				command === 1
					? { _tag: "KnobRotate", delta: value === 1 ? 1 : -1 }
					: { _tag: "KnobPress", state: value },
			),
		);
	}
	if (opcode === 0x55 && command === 0xef)
		return Either.right(Option.some({ _tag: "KeepAlive" }));
	if (command === 26) {
		if (value === undefined || sub.length !== 1 + 5 * value)
			return Either.left(new QuakeReportInvalid());
		const points = Array.from({ length: value }, (_, index) => {
			const offset = 1 + index * 5;
			return {
				action: sub[offset] ?? 0,
				y: (sub[offset + 1] ?? 0) | ((sub[offset + 2] ?? 0) << 8),
				x: (sub[offset + 3] ?? 0) | ((sub[offset + 4] ?? 0) << 8),
			};
		});
		return Either.right(Option.some({ _tag: "Touch", points }));
	}
	return Either.right(Option.none());
}
