import { Either, ParseResult, Schema } from "effect";
import { type ProtocolError, ProtocolInputInvalid } from "./errors.js";

/** Inventory §1 and .agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/99-dk-suite.rules.txt.
 * Sources live read-only under /Users/ramarivera/dev/open-quake/. */
export const QUAKE_USAGE_PAGE = 0xff60;
export const QUAKE_USAGE = 0x61;
export const QUAKE_VENDOR_ID = 0x4158;
export const QUAKE_PRODUCT_ID = 0x514b;
export const HID_REPORT_SIZE = 33;
export const HID_BODY_SIZE = 32;
export const QUAKE_IDENTITY = {
	usagePage: QUAKE_USAGE_PAGE,
	usage: QUAKE_USAGE,
	vendorId: QUAKE_VENDOR_ID,
	productId: QUAKE_PRODUCT_ID,
} as const;
export const QuakeIdentity = Schema.Struct({
	usagePage: Schema.Literal(QUAKE_USAGE_PAGE),
	usage: Schema.Literal(QUAKE_USAGE),
	vendorId: Schema.Literal(QUAKE_VENDOR_ID),
	productId: Schema.Literal(QUAKE_PRODUCT_ID),
});
export const isQuakeInterface = Schema.is(QuakeIdentity);
export const Bytes = Schema.Array(Schema.Uint8);
export const ByteInput = Schema.Union(Bytes, Schema.Uint8ArrayFromSelf);
export type ByteInput = typeof ByteInput.Type;
export const ShortCommand = Schema.Struct({
	opCode: Schema.Uint8,
	cmdId: Schema.Uint8,
	subData: Bytes.pipe(Schema.maxItems(253)),
});
export type ShortCommand = typeof ShortCommand.Type;

export function validate<A>(
	schema: Schema.Schema<A>,
	input: unknown,
): Either.Either<A, ProtocolInputInvalid> {
	return Schema.decodeUnknownEither(schema)(input).pipe(
		Either.mapLeft((cause) => new ProtocolInputInvalid(cause)),
	);
}

export function readBytes(
	input: unknown,
): Either.Either<readonly number[], ProtocolInputInvalid> {
	return validate(ByteInput, input).pipe(
		Either.map((bytes) => Array.from(bytes)),
	);
}

/** Schema adapters use the same pure functions; rich failures remain on the Either API. */
export function byteCodec<A>(
	contract: Schema.Schema<A>,
	decode: (input: ByteInput) => Either.Either<A, ProtocolError>,
	encode: (value: A) => Either.Either<Uint8Array, ProtocolError>,
) {
	return Schema.transformOrFail(ByteInput, contract, {
		strict: true,
		decode: (input, _options, ast) =>
			decode(input).pipe(
				Either.mapLeft(
					(error) => new ParseResult.Type(ast, undefined, error.code),
				),
			),
		encode: (value, _options, ast) =>
			encode(value).pipe(
				Either.mapLeft(
					(error) => new ParseResult.Type(ast, undefined, error.code),
				),
			),
	});
}
