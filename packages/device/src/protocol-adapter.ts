/** Map protocol-decoded commands to device events. Framing belongs to the kernel. */
import {
	decodeHardwareReply,
	decodeHidReport,
	decodeKeyMatrix,
	encodeHardwareCommand,
	encodeHidReport,
	FRAME_HEADER,
	FrameSizeInvalid,
	type ProtocolError,
	unwrapJsonFrame,
	unwrapResourceFrame,
	unwrapShortCommand,
	wrapShortCommand,
} from "@open-quake/protocol";
import { Either, Option } from "effect";
import type { DeviceEvent } from "./device-contracts.js";

export const keepAliveFrame = (): Either.Either<Uint8Array, ProtocolError> =>
	wrapShortCommand({ opCode: 2, cmdId: 0xef, subData: [] });
export const keepAliveReport = (): Either.Either<Uint8Array, ProtocolError> =>
	keepAliveFrame().pipe(Either.flatMap(encodeHidReport));

export const screenPowerReport = (
	on: boolean,
): Either.Either<Uint8Array, ProtocolError> =>
	encodeHardwareCommand({ _tag: "ScreenPower", on });

export function decodeReport(
	input: Uint8Array,
): Either.Either<Option.Option<DeviceEvent>, ProtocolError> {
	const physical = decodeHidReport(input);
	if (Either.isLeft(physical)) return Either.left(physical.left);
	if (physical.right[0] === 0xa1)
		return unwrapJsonFrame(physical.right).pipe(
			Either.map((value) => Option.some<DeviceEvent>({ _tag: "Json", value })),
		);
	if (physical.right[0] === 0xa2)
		return unwrapResourceFrame(physical.right).pipe(
			Either.map((envelope) =>
				Option.some<DeviceEvent>({ _tag: "Resource", envelope }),
			),
		);
	if (physical.right[0] === 1)
		return decodeKeyMatrix(physical.right).pipe(
			Either.map((matrix) =>
				Option.some<DeviceEvent>({ _tag: "Matrix", matrix }),
			),
		);
	if (physical.right[0] !== FRAME_HEADER) return Either.right(Option.none());
	const decoded = unwrapShortCommand(physical.right);
	if (Either.isLeft(decoded)) return Either.left(decoded.left);
	const hardware = decodeHardwareReply(decoded.right);
	if (Either.isLeft(hardware)) return Either.left(hardware.left);
	if (Option.isSome(hardware.right))
		return Either.right(
			Option.some({ _tag: "HardwareReply", reply: hardware.right.value }),
		);
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

/** Wide envelopes can span several fixed HID reads. State belongs to one session. */
export function makeReportDecoder() {
	let pending = new Uint8Array(0);
	return {
		push(
			input: Uint8Array,
		): Either.Either<Option.Option<DeviceEvent>, ProtocolError> {
			const body = decodeHidReport(input);
			if (Either.isLeft(body)) return Either.left(body.left);
			const first = pending.length ? pending[0] : body.right[0];
			if (first !== 0xa1 && first !== 0xa2) return decodeReport(input);
			const combined = new Uint8Array(pending.length + body.right.length);
			combined.set(pending);
			combined.set(body.right, pending.length);
			const size = (combined[1] ?? 0) * 256 + (combined[2] ?? 0) + 4;
			if (combined.length < size) {
				pending = combined;
				return Either.right(Option.none());
			}
			pending = new Uint8Array(0);
			if (combined.slice(size).some((byte) => byte !== 0))
				return Either.left(new FrameSizeInvalid(combined.length, size));
			const frame = combined.slice(0, size);
			return first === 0xa1
				? unwrapJsonFrame(frame).pipe(
						Either.map((value) =>
							Option.some<DeviceEvent>({ _tag: "Json", value }),
						),
					)
				: unwrapResourceFrame(frame).pipe(
						Either.map((envelope) =>
							Option.some<DeviceEvent>({ _tag: "Resource", envelope }),
						),
					);
		},
		finish(): Either.Either<void, ProtocolError> {
			return pending.length
				? Either.left(
						new FrameSizeInvalid(
							pending.length,
							(pending[1] ?? 0) * 256 + (pending[2] ?? 0) + 4,
						),
					)
				: Either.right(undefined);
		},
	};
}
