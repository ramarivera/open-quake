import { Either, Schema } from "effect";
import { Bytes, byteCodec, readBytes, validate } from "./contracts.js";
import {
	FrameSizeInvalid,
	type ProtocolError,
	QmkResponseMismatch,
} from "./errors.js";
import { decodeHidReport, encodeHidReport } from "./framing.js";

export const QmkCommand = Schema.Union(
	Schema.Struct({ command: Schema.Literal(1) }),
	Schema.Struct({
		command: Schema.Literal(7),
		lightingValue: Schema.Uint8,
		values: Bytes.pipe(Schema.maxItems(30)),
	}),
	Schema.Struct({
		command: Schema.Literal(8),
		lightingValue: Schema.Uint8,
		resultLength: Schema.Int.pipe(Schema.between(1, 30)),
	}),
	Schema.Struct({
		command: Schema.Literal(9),
		channelId: Schema.optional(Schema.Uint8),
	}),
);
export type QmkCommand = typeof QmkCommand.Type;
export const QmkResponse = Schema.Union(
	Schema.Struct({
		command: Schema.Literal(1),
		version: Schema.Int.pipe(Schema.between(0, 65535)),
	}),
	Schema.Struct({
		command: Schema.Literal(8),
		lightingValue: Schema.Uint8,
		values: Bytes,
	}),
	Schema.Struct({
		command: Schema.Literal(7, 9),
		acknowledged: Schema.Literal(true),
	}),
);
export type QmkResponse = typeof QmkResponse.Type;

function commandBytes(input: QmkCommand): readonly number[] {
	switch (input.command) {
		case 1:
			return [1];
		case 7:
			return [7, input.lightingValue, ...input.values];
		case 8:
			return [8, input.lightingValue];
		case 9:
			return input.channelId === undefined ? [9] : [9, input.channelId];
	}
}
/** Source: .agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/hid_connector_context.js,
 * QMKHidService buildCommand/decodeProtocolVersion/decodeBacklightGetResponse.
 * These raw QMK commands are not the A3 commands in the firmware/template docs. */
export function encodeQmkCommand(
	input: QmkCommand,
): Either.Either<Uint8Array, ProtocolError> {
	return validate(QmkCommand, input).pipe(
		Either.flatMap((value) => encodeHidReport(commandBytes(value))),
	);
}

/** Decode with the originating request. Compact responses are accepted for tests
 * and adapters, while 32/33-byte node-hid reports follow the same echo rules. */
export function decodeQmkResponse(
	request: QmkCommand,
	input: unknown,
): Either.Either<QmkResponse, ProtocolError> {
	return validate(QmkCommand, request).pipe(
		Either.flatMap((command) =>
			readBytes(input).pipe(
				Either.flatMap((raw): Either.Either<QmkResponse, ProtocolError> => {
					if (raw.length === 33 && raw[0] !== 0)
						return Either.left(new QmkResponseMismatch());
					const body = raw.length === 33 ? raw.slice(1) : raw;
					const minimum =
						command.command === 1
							? 3
							: command.command === 8
								? 2 + command.resultLength
								: commandBytes(command).length;
					if (body.length < minimum || body.length > 32)
						return Either.left(new FrameSizeInvalid(body.length, minimum, 32));
					const prefix = commandBytes(command);
					if (!prefix.every((byte, index) => body[index] === byte))
						return Either.left(new QmkResponseMismatch());
					switch (command.command) {
						case 1:
							return Either.right({
								command: 1 as const,
								version: (body[1] ?? 0) * 256 + (body[2] ?? 0),
							});
						case 8: {
							const values = Array.from(
								body.slice(2, 2 + command.resultLength),
							);
							if (values.length !== command.resultLength)
								return Either.left(
									new FrameSizeInvalid(values.length, command.resultLength),
								);
							return Either.right({
								command: 8 as const,
								lightingValue: command.lightingValue,
								values,
							});
						}
						default:
							return Either.right({
								command: command.command,
								acknowledged: true as const,
							});
					}
				}),
			),
		),
	);
}

/** Parameter counts must come from the QMK request, since zero is valid data
 * and reports carry no parameter-length field. */
export const QmkRawCommand = Schema.Struct({
	command: Schema.Literal(1, 7, 8, 9),
	params: Bytes.pipe(Schema.maxItems(31)),
}).pipe(
	Schema.filter((value) => {
		switch (value.command) {
			case 1:
				return value.params.length === 0;
			case 7:
				return value.params.length >= 1;
			case 8:
				return value.params.length === 1;
			case 9:
				return value.params.length <= 1;
		}
		return false;
	}),
);
export type QmkRawCommand = typeof QmkRawCommand.Type;

export function wrapQmkCommand(
	input: QmkRawCommand,
): Either.Either<Uint8Array, ProtocolError> {
	return validate(QmkRawCommand, input).pipe(
		Either.flatMap((command) =>
			encodeHidReport([command.command, ...command.params]),
		),
	);
}
export function decodeQmkCommand(
	input: unknown,
	parameterLength: number,
): Either.Either<QmkRawCommand, ProtocolError> {
	return validate(Schema.Int.pipe(Schema.between(0, 31)), parameterLength).pipe(
		Either.flatMap((count) =>
			decodeHidReport(input).pipe(
				Either.flatMap((body): Either.Either<QmkRawCommand, ProtocolError> => {
					if (body.slice(1 + count).some((value) => value !== 0))
						return Either.left(new QmkResponseMismatch());
					return validate(QmkRawCommand, {
						command: body[0],
						params: Array.from(body.slice(1, 1 + count)),
					});
				}),
			),
		),
	);
}
export function qmkCommandReport(parameterLength: number) {
	return byteCodec(
		QmkRawCommand,
		(input) => decodeQmkCommand(input, parameterLength),
		(input) =>
			validate(Schema.Int.pipe(Schema.between(0, 31)), parameterLength).pipe(
				Either.flatMap((count) =>
					input.params.length === count
						? wrapQmkCommand(input)
						: Either.left(new FrameSizeInvalid(input.params.length, count)),
				),
			),
	);
}
