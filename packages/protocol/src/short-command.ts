import { Either } from "effect";
import { FRAME_HEADER } from "./checksum.js";
import { byteCodec, ShortCommand, validate } from "./contracts.js";
import type { ProtocolError } from "./errors.js";
import { decodeEnvelope, encodeEnvelope } from "./framing.js";

/** .context/decokee-quake-template/modules/quake-device/protocol.js,
 * wrapControl/parseReport, cross-checked with docs/PROTOCOL.md. */
export function wrapShortCommand(
	input: ShortCommand,
): Either.Either<Uint8Array, ProtocolError> {
	return validate(ShortCommand, input).pipe(
		Either.map((value) =>
			encodeEnvelope(
				FRAME_HEADER,
				[value.opCode, value.cmdId, ...value.subData],
				false,
			),
		),
	);
}

export function unwrapShortCommand(
	input: unknown,
): Either.Either<ShortCommand, ProtocolError> {
	return decodeEnvelope(input, FRAME_HEADER, 2, 2).pipe(
		Either.map((body) => ({
			opCode: body[0] ?? 0,
			cmdId: body[1] ?? 0,
			subData: body.slice(2),
		})),
	);
}
export const ShortCommandFrame = byteCodec(
	ShortCommand,
	unwrapShortCommand,
	wrapShortCommand,
);

/** Confirmed DFU: flag 1, command 47, subcommand 3. No I/O.
 * Sources: docs/PROTOCOL.md DFU; template modules/quake-device/device.js enterDfu. */
export const dfuCommand = (): ShortCommand => ({
	opCode: 1,
	cmdId: 0x2f,
	subData: [3],
});
