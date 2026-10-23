import { Either, Schema } from "effect";
import { checksum } from "./checksum.js";
import {
	byteCodec,
	HID_BODY_SIZE,
	HID_REPORT_SIZE,
	readBytes,
	validate,
} from "./contracts.js";
import {
	FrameChecksumMismatch,
	FrameSizeInvalid,
	FrameTypeUnsupported,
	type ProtocolError,
} from "./errors.js";

/** node-hid strips report ID on reads; host writes include it.
 * Source: .context/decokee-quake-fw/docs/PROTOCOL.md, Interfaces. */
export function decodeHidReport(
	input: unknown,
): Either.Either<Uint8Array, ProtocolError> {
	return readBytes(input).pipe(
		Either.flatMap((bytes): Either.Either<Uint8Array, ProtocolError> => {
			if (bytes.length === HID_BODY_SIZE)
				return Either.right(Uint8Array.from(bytes));
			if (bytes.length !== HID_REPORT_SIZE)
				return Either.left(
					new FrameSizeInvalid(bytes.length, HID_BODY_SIZE, HID_REPORT_SIZE),
				);
			if (bytes[0] !== 0) return Either.left(new FrameTypeUnsupported());
			return Either.right(Uint8Array.from(bytes.slice(1)));
		}),
	);
}

export function encodeHidReport(
	input: unknown,
): Either.Either<Uint8Array, ProtocolError> {
	return readBytes(input).pipe(
		Either.flatMap((bytes): Either.Either<Uint8Array, ProtocolError> => {
			if (bytes.length > HID_BODY_SIZE)
				return Either.left(
					new FrameSizeInvalid(bytes.length, 0, HID_BODY_SIZE),
				);
			const report = new Uint8Array(HID_REPORT_SIZE);
			report.set(bytes, 1);
			return Either.right(report);
		}),
	);
}

const HidBody = Schema.Uint8ArrayFromSelf.pipe(
	Schema.filter((bytes) => bytes.length === HID_BODY_SIZE),
);
/** Canonical codec has a full 32-byte body; encodeHidReport also accepts compact data. */
export const HidReport = byteCodec(HidBody, decodeHidReport, (input) =>
	validate(HidBody, input).pipe(Either.flatMap(encodeHidReport)),
);

/** Shared declared-length validation. Only fixed-size reports may carry zero padding.
 * Source: .agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/ProtocolUtil.js.head.txt, checkSumValid.
 * Length excludes checksum, unlike the incoming-length prose in PROTOCOL.md. */
export function decodeEnvelope(
	input: unknown,
	type: number,
	start: 2 | 3,
	minimum: number,
): Either.Either<readonly number[], ProtocolError> {
	return readBytes(input).pipe(
		Either.flatMap((raw): Either.Either<readonly number[], ProtocolError> => {
			const bytes =
				raw.length === HID_REPORT_SIZE && raw[0] === 0 ? raw.slice(1) : raw;
			if (bytes[0] !== type) return Either.left(new FrameTypeUnsupported());
			if (bytes.length < start + minimum + 1)
				return Either.left(
					new FrameSizeInvalid(bytes.length, start + minimum + 1, 65539),
				);
			const size =
				start === 2 ? (bytes[1] ?? 0) : (bytes[1] ?? 0) * 256 + (bytes[2] ?? 0);
			if (size < minimum)
				return Either.left(
					new FrameSizeInvalid(size, minimum, start === 2 ? 255 : 65535),
				);
			const end = start + size;
			if (
				bytes.length < end + 1 ||
				(bytes.length !== end + 1 &&
					(bytes.length !== HID_BODY_SIZE ||
						bytes.slice(end + 1).some((byte) => byte !== 0)))
			) {
				return Either.left(new FrameSizeInvalid(bytes.length, end + 1));
			}
			const body = bytes.slice(start, end);
			return bytes[end] === checksum(body)
				? Either.right(body)
				: Either.left(new FrameChecksumMismatch());
		}),
	);
}

/** Internal: validated callers bound the body to the header's length field. */
export function encodeEnvelope(
	type: number,
	body: readonly number[],
	wide: boolean,
): Uint8Array {
	const length = wide ? [body.length >>> 8, body.length & 255] : [body.length];
	return Uint8Array.from([type, ...length, ...body, checksum(body)]);
}
