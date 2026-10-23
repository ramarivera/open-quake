import { Either, Option, Schema } from "effect";
import { Bytes, byteCodec, validate } from "./contracts.js";
import { FrameTypeUnsupported, type ProtocolError } from "./errors.js";
import { decodeHidReport, encodeHidReport } from "./framing.js";

export const KeyMatrix = Schema.Struct({
	reserved: Bytes.pipe(Schema.itemsCount(3)),
	states: Bytes.pipe(Schema.itemsCount(15)),
	tail: Bytes.pipe(Schema.itemsCount(13)),
});
export type KeyMatrix = typeof KeyMatrix.Type;
export const KeyPress = Schema.Struct({
	type: Schema.Literal("press"),
	keyAction: Schema.Literal(0),
	row: Schema.Int.pipe(Schema.between(1, 3)),
	column: Schema.Int.pipe(Schema.between(1, 5)),
	keyCode: Schema.String,
});
export type KeyPress = typeof KeyPress.Type;

/** First marked cell, as in recovered ProtocolUtil.checkDataValid case 01.
 * Source: .agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/ProtocolUtil.js.head.txt.
 * The recovered decoder supplies no release semantics or physical key layout. */
export function firstMatrixPress(matrix: KeyMatrix): Option.Option<KeyPress> {
	const index = matrix.states.indexOf(1);
	if (index < 0) return Option.none();
	const row = Math.floor(index / 5) + 1;
	const column = (index % 5) + 1;
	return Option.some({
		type: "press",
		keyAction: 0,
		row,
		column,
		keyCode: `${row},${column}`,
	});
}
export function decodeKeyMatrix(
	input: unknown,
): Either.Either<KeyMatrix, ProtocolError> {
	return decodeHidReport(input).pipe(
		Either.flatMap(
			(body): Either.Either<KeyMatrix, ProtocolError> =>
				body[0] !== 1
					? Either.left(new FrameTypeUnsupported())
					: validate(KeyMatrix, {
							reserved: Array.from(body.slice(1, 4)),
							states: Array.from(body.slice(4, 19)),
							tail: Array.from(body.slice(19)),
						}),
		),
	);
}
export function encodeKeyMatrix(
	input: KeyMatrix,
): Either.Either<Uint8Array, ProtocolError> {
	return validate(KeyMatrix, input).pipe(
		Either.flatMap((matrix) =>
			encodeHidReport([
				1,
				...matrix.reserved,
				...matrix.states,
				...matrix.tail,
			]),
		),
	);
}
export const KeyMatrixReport = byteCodec(
	KeyMatrix,
	decodeKeyMatrix,
	encodeKeyMatrix,
);
