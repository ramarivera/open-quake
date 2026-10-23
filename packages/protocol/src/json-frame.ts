import { Either, Schema } from "effect";
import { byteCodec } from "./contracts.js";
import {
	FrameSizeInvalid,
	type ProtocolError,
	ProtocolJsonInvalid,
} from "./errors.js";
import { decodeEnvelope, encodeEnvelope } from "./framing.js";

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };
export const JsonValue: Schema.Schema<JsonValue> = Schema.suspend(() =>
	Schema.Union(
		Schema.Null,
		Schema.Boolean,
		Schema.JsonNumber,
		Schema.String,
		Schema.Array(JsonValue),
		Schema.Record({ key: Schema.String, value: JsonValue }),
	),
);

/** A1 UTF-8 JSON; length is a big-endian uint16 counting data bytes only.
 * Source: .agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/ProtocolUtil.js.head.txt, wrapData A1.
 * Firmware docs/template only implement A3 and cannot establish A1/A2 layouts. */
export function wrapJsonFrame(
	input: JsonValue,
): Either.Either<Uint8Array, ProtocolError> {
	// JSON.stringify is a genuine failure boundary, including cyclic JS input.
	return Either.try({
		try: () => {
			const text = JSON.stringify(input);
			return { text, validated: Schema.decodeUnknownEither(JsonValue)(input) };
		},
		catch: (cause) => new ProtocolJsonInvalid(cause),
	}).pipe(
		Either.flatMap(
			({ text, validated }): Either.Either<Uint8Array, ProtocolError> => {
				if (typeof text !== "string")
					return Either.left(new ProtocolJsonInvalid(undefined));
				if (Either.isLeft(validated))
					return Either.left(new ProtocolJsonInvalid(validated.left));
				const data = new TextEncoder().encode(text);
				return data.length <= 65535
					? Either.right(encodeEnvelope(0xa1, Array.from(data), true))
					: Either.left(new FrameSizeInvalid(data.length, 0, 65535));
			},
		),
	);
}

export function unwrapJsonFrame(
	input: unknown,
): Either.Either<JsonValue, ProtocolError> {
	return decodeEnvelope(input, 0xa1, 3, 1).pipe(
		Either.flatMap((bytes) =>
			Either.try({
				try: () =>
					JSON.parse(
						new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
							Uint8Array.from(bytes),
						),
					) as unknown,
				catch: (cause) => new ProtocolJsonInvalid(cause),
			}),
		),
		Either.flatMap((value) =>
			Schema.decodeUnknownEither(JsonValue)(value).pipe(
				Either.mapLeft((cause) => new ProtocolJsonInvalid(cause)),
			),
		),
	);
}
export const JsonFrame = byteCodec(JsonValue, unwrapJsonFrame, wrapJsonFrame);
