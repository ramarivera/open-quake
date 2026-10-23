import { Either, Schema } from "effect";
import { Bytes, byteCodec, validate } from "./contracts.js";
import type { ProtocolError } from "./errors.js";
import { decodeEnvelope, encodeEnvelope } from "./framing.js";

export const ResourceEnvelope = Schema.Struct({
	opCode: Schema.Uint8,
	metadata: Schema.Tuple(
		Schema.Uint8,
		Schema.Uint8,
		Schema.Uint8,
		Schema.Uint8,
		Schema.Uint8,
	),
	sequence: Schema.Uint8,
	payload: Bytes.pipe(Schema.maxItems(65528)),
});
export type ResourceEnvelope = typeof ResourceEnvelope.Type;

/** Partial A2 support. Preserves opaque payload, reserved bytes and unknown opcodes.
 * Source: .agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/ProtocolUtil.js.head.txt, wrapData A2.
 * Neither firmware PROTOCOL.md nor the template validates image transfer semantics. */
export function wrapResourceFrame(
	input: ResourceEnvelope,
): Either.Either<Uint8Array, ProtocolError> {
	return validate(ResourceEnvelope, input).pipe(
		Either.map((value) =>
			encodeEnvelope(
				0xa2,
				[value.opCode, ...value.metadata, value.sequence, ...value.payload],
				true,
			),
		),
	);
}
export function unwrapResourceFrame(
	input: unknown,
): Either.Either<ResourceEnvelope, ProtocolError> {
	return decodeEnvelope(input, 0xa2, 3, 7).pipe(
		Either.flatMap((body) =>
			validate(ResourceEnvelope, {
				opCode: body[0],
				metadata: body.slice(1, 6),
				sequence: body[6],
				payload: body.slice(7),
			}),
		),
	);
}
export const ResourceFrame = byteCodec(
	ResourceEnvelope,
	unwrapResourceFrame,
	wrapResourceFrame,
);

/** Structural interpretation only; no assertion about physical key/icon mapping. */
export function resourceMetadata(value: ResourceEnvelope) {
	const [kind, a, b, c, d] = value.metadata;
	if (value.opCode === 2)
		return {
			kind: "raw" as const,
			resourceType: kind,
			row: a,
			column: b,
			reserved: [c, d] as const,
		};
	if (value.opCode === 1)
		return {
			kind: "file" as const,
			prefix: kind,
			id: a * 0x1000000 + b * 0x10000 + c * 0x100 + d,
		};
	return {
		kind: "unknown" as const,
		opCode: value.opCode,
		bytes: value.metadata,
	};
}
