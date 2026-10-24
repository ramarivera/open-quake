/** Map protocol-decoded commands to device events. Framing belongs to the kernel. */
import {
	decodeHidReport,
	encodeHidReport,
	FRAME_HEADER,
	FrameSizeInvalid,
	type ProtocolError,
	unwrapShortCommand,
	wrapShortCommand,
} from "@open-quake/protocol";
import { Either, Option } from "effect";
import type { DeviceEvent } from "./device-contracts.js";

export const keepAliveFrame = (): Either.Either<Uint8Array, ProtocolError> =>
	wrapShortCommand({ opCode: 2, cmdId: 0xef, subData: [] });
export const keepAliveReport = (): Either.Either<Uint8Array, ProtocolError> =>
	keepAliveFrame().pipe(Either.flatMap(encodeHidReport));

export function decodeReport(
	input: Uint8Array,
): Either.Either<Option.Option<DeviceEvent>, ProtocolError> {
	const physical = decodeHidReport(input);
	if (Either.isLeft(physical)) return Either.left(physical.left);
	if (physical.right[0] !== FRAME_HEADER) return Either.right(Option.none());
	const decoded = unwrapShortCommand(physical.right);
	if (Either.isLeft(decoded)) return Either.left(decoded.left);
	const { opCode: opcode, cmdId: command, subData: sub } = decoded.right;
	const value = sub[0];
	if (opcode === 3 && (command === 1 || command === 2)) {
		if (value === undefined)
			return Either.left(new FrameSizeInvalid(sub.length, 1));
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
	// Legacy synthetic checksummed touch envelope, retained for compatibility.
	// Real vendor input uses touch/ on its own separately selected HID handle.
	if (opcode === 0xa3 && command === 26) {
		if (value === undefined || sub.length !== 1 + 5 * value)
			return Either.left(
				new FrameSizeInvalid(sub.length, 1 + 5 * (value ?? 0)),
			);
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
