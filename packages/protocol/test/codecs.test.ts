import { describe, expect, it } from "@effect/vitest";
import { Either, Option, Schema } from "effect";
import * as fc from "fast-check";
import {
	checksum,
	decodeHidReport,
	decodeKeyMatrix,
	decodeQmkCommand,
	decodeQmkResponse,
	dfuCommand,
	encodeHidReport,
	encodeKeyMatrix,
	encodeQmkCommand,
	FrameChecksumMismatch,
	FrameSizeInvalid,
	FrameTypeUnsupported,
	firstMatrixPress,
	HidReport,
	isQuakeInterface,
	JsonFrame,
	JsonValue,
	type KeyMatrix,
	KeyMatrixReport,
	type ProtocolError,
	ProtocolErrors,
	ProtocolInputInvalid,
	ProtocolJsonInvalid,
	type QmkRawCommand,
	QmkResponseMismatch,
	QUAKE_IDENTITY,
	qmkCommandReport,
	type ResourceEnvelope,
	ResourceFrame,
	resourceMetadata,
	type ShortCommand,
	ShortCommandFrame,
	unwrapJsonFrame,
	unwrapResourceFrame,
	unwrapShortCommand,
	verifyDeviceReport,
	wrapJsonFrame,
	wrapQmkCommand,
	wrapResourceFrame,
	wrapShortCommand,
} from "../src/index.js";

function right<A, E>(result: Either.Either<A, E>): A {
	expect(Either.isRight(result)).toBe(true);
	return Either.getOrThrow(result);
}
function left<A>(result: Either.Either<A, ProtocolError>): ProtocolError {
	expect(Either.isLeft(result)).toBe(true);
	return Either.getOrThrow(Either.flip(result));
}
const byte = fc.integer({ min: 0, max: 255 });
const bytes = (maxLength: number) => fc.array(byte, { maxLength });
const short = fc.record({ opCode: byte, cmdId: byte, subData: bytes(253) });
const resource = fc.record({
	opCode: byte,
	metadata: fc.tuple(byte, byte, byte, byte, byte),
	sequence: byte,
	payload: bytes(1024),
});
const matrix = fc.record({
	reserved: fc.array(byte, { minLength: 3, maxLength: 3 }),
	states: fc.array(byte, { minLength: 15, maxLength: 15 }),
	tail: fc.array(byte, { minLength: 13, maxLength: 13 }),
});

function schemaRoundTrip<A>(
	schema: Schema.Schema<A, readonly number[] | Uint8Array>,
	value: A,
): void {
	const encoded = right(Schema.encodeEither(schema)(value));
	expect(right(Schema.decodeUnknownEither(schema)(encoded))).toEqual(value);
}

// Sources for vectors: firmware docs/PROTOCOL.md (keep-alive, DFU, state),
// template modules/quake-device/protocol.js (executable length interpretation),
// dark-encyclopedia artifacts/ProtocolUtil.js.head.txt (A1/A2 and matrix),
// artifacts/hid_connector_context.js (QMK). Research root is the main checkout.
describe("known protocol vectors", () => {
	it("wraps and unwraps keep-alive and DFU", () => {
		const keepAlive = [0xa3, 2, 2, 0xef, 0xf1];
		expect(
			right(wrapShortCommand({ opCode: 2, cmdId: 0xef, subData: [] })),
		).toEqual(Uint8Array.from(keepAlive));
		expect(right(unwrapShortCommand(keepAlive))).toEqual({
			opCode: 2,
			cmdId: 0xef,
			subData: [],
		});
		expect(Array.from(right(wrapShortCommand(dfuCommand())))).toEqual([
			0xa3, 3, 1, 0x2f, 3, 0x33,
		]);
	});
	it("validates a STATE mic response using length rather than padding", () => {
		const frame = [0xa3, 3, 0x55, 3, 1, 0x59];
		const report = right(encodeHidReport(frame));
		expect(right(unwrapShortCommand(report))).toEqual({
			opCode: 0x55,
			cmdId: 3,
			subData: [1],
		});
		expect(verifyDeviceReport(Array.from(report))).toBe(true);
		expect(verifyDeviceReport(Array.from(report.slice(1)))).toBe(true);
	});
	it("uses big-endian JSON byte length and a data-only checksum", () => {
		expect(Array.from(right(wrapJsonFrame({})))).toEqual([
			0xa1, 0, 2, 0x7b, 0x7d, 0xf8,
		]);
		expect(right(unwrapJsonFrame([0xa1, 0, 2, 0x7b, 0x7d, 0xf8]))).toEqual({});
		const text = "界".repeat(100);
		const frame = right(wrapJsonFrame(text));
		expect(Array.from(frame.slice(1, 3))).toEqual([1, 46]);
		expect(right(unwrapJsonFrame(frame))).toBe(text);
	});
	it("uses JSON number semantics for signed zero", () => {
		expect(right(unwrapJsonFrame(right(wrapJsonFrame({ value: -0 }))))).toEqual(
			{ value: 0 },
		);
	});
	it("preserves JSON keys without changing object prototypes", () => {
		const value = right(
			Schema.decodeUnknownEither(JsonValue)(
				JSON.parse(
					'{"__proto__":{"polluted":true},"constructor":1,"toString":2}',
				) as unknown,
			),
		);
		expect(right(unwrapJsonFrame(right(wrapJsonFrame(value))))).toEqual(value);
		expect(Object.getPrototypeOf({})).toBe(Object.prototype);
	});
	it("preserves resource metadata, sequence and payload", () => {
		const input: ResourceEnvelope = {
			opCode: 2,
			metadata: [0, 1, 2, 0, 0],
			sequence: 4,
			payload: [0xff, 0xd8],
		};
		const expected = [0xa2, 0, 9, 2, 0, 1, 2, 0, 0, 4, 0xff, 0xd8, 0xe1];
		expect(Array.from(right(wrapResourceFrame(input)))).toEqual(expected);
		expect(right(unwrapResourceFrame(expected))).toEqual(input);
		expect(resourceMetadata(input)).toEqual({
			kind: "raw",
			resourceType: 0,
			row: 1,
			column: 2,
			reserved: [0, 0],
		});
		expect(
			resourceMetadata({
				...input,
				opCode: 1,
				metadata: [3, 0xff, 0xff, 0xff, 0xff],
			}),
		).toEqual({ kind: "file", prefix: 3, id: 4294967295 });
	});
	it("maps all fifteen matrix cells with recovered row/column ordering", () => {
		for (let index = 0; index < 15; index++) {
			const body = new Uint8Array(32);
			body[0] = 1;
			body[4 + index] = 1;
			const result = firstMatrixPress(right(decodeKeyMatrix(body)));
			expect(Option.getOrThrow(result)).toEqual({
				type: "press",
				keyAction: 0,
				row: Math.floor(index / 5) + 1,
				column: (index % 5) + 1,
				keyCode: `${Math.floor(index / 5) + 1},${(index % 5) + 1}`,
			});
		}
		const noPress: KeyMatrix = {
			reserved: [0, 0, 0],
			states: new Array<number>(15).fill(0),
			tail: new Array<number>(13).fill(0),
		};
		expect(firstMatrixPress(noPress)).toEqual(Option.none());
		const multiple = { ...noPress, states: [1, 1, ...noPress.states.slice(2)] };
		expect(Option.getOrThrow(firstMatrixPress(multiple)).keyCode).toBe("1,1");
	});
	it("encodes QMK version, backlight set/get and save commands", () => {
		for (const [input, prefix] of [
			[{ command: 1 }, [0, 1]],
			[{ command: 7, lightingValue: 9, values: [0x80] }, [0, 7, 9, 0x80]],
			[{ command: 8, lightingValue: 9, resultLength: 1 }, [0, 8, 9]],
			[{ command: 9 }, [0, 9]],
			[{ command: 9, channelId: 3 }, [0, 9, 3]],
		] as const) {
			const report = right(encodeQmkCommand(input));
			expect(report.length).toBe(33);
			expect(Array.from(report.slice(0, prefix.length))).toEqual(prefix);
			expect(report.slice(prefix.length).every((value) => value === 0)).toBe(
				true,
			);
		}
		expect(right(decodeQmkResponse({ command: 1 }, [1, 0x12, 0x34]))).toEqual({
			command: 1,
			version: 0x1234,
		});
		expect(
			right(
				decodeQmkResponse(
					{ command: 8, lightingValue: 9, resultLength: 2 },
					[8, 9, 0x80, 0x40],
				),
			),
		).toEqual({ command: 8, lightingValue: 9, values: [0x80, 0x40] });
		expect(
			right(
				decodeQmkResponse(
					{ command: 7, lightingValue: 9, values: [0x80] },
					[7, 9, 0x80],
				),
			),
		).toEqual({ command: 7, acknowledged: true });
		expect(right(decodeQmkResponse({ command: 9 }, [9]))).toEqual({
			command: 9,
			acknowledged: true,
		});
	});
});

describe("round-trip properties", () => {
	it("round-trips A3 and its Schema codec across the full byte-length range", () => {
		fc.assert(
			fc.property(short, (value) => {
				const frame = right(wrapShortCommand(value));
				expect(frame.length).toBe(value.subData.length + 5);
				expect(frame[1]).toBe(value.subData.length + 2);
				expect(right(unwrapShortCommand(frame))).toEqual(value);
				expect(verifyDeviceReport(Array.from(frame))).toBe(true);
				schemaRoundTrip(ShortCommandFrame, value);
			}),
			{ numRuns: 500 },
		);
	});
	it("round-trips arbitrary JSON through functions and Schema", () => {
		fc.assert(
			fc.property(
				fc
					.json({ maxDepth: 4 })
					.map((value) =>
						right(
							Schema.decodeUnknownEither(JsonValue)(
								JSON.parse(value) as unknown,
							),
						),
					),
				(value) => {
					expect(right(unwrapJsonFrame(right(wrapJsonFrame(value))))).toEqual(
						value,
					);
					schemaRoundTrip(JsonFrame, value);
				},
			),
			{ numRuns: 300 },
		);
	});
	it("round-trips A2 including unknown opcodes and reserved metadata", () => {
		fc.assert(
			fc.property(resource, (value) => {
				const frame = right(wrapResourceFrame(value));
				expect(right(unwrapResourceFrame(frame))).toEqual(value);
				expect(frame.at(-1)).toBe(checksum(Array.from(frame.slice(3, -1))));
				schemaRoundTrip(ResourceFrame, value);
			}),
			{ numRuns: 300 },
		);
	});
	it("round-trips canonical HID bodies and matrix reports", () => {
		fc.assert(
			fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (value) => {
				expect(right(decodeHidReport(right(encodeHidReport(value))))).toEqual(
					value,
				);
				schemaRoundTrip(HidReport, value);
			}),
		);
		fc.assert(
			fc.property(matrix, (value) => {
				expect(right(decodeKeyMatrix(right(encodeKeyMatrix(value))))).toEqual(
					value,
				);
				schemaRoundTrip(KeyMatrixReport, value);
			}),
		);
	});
	it("round-trips QMK raw commands with explicit parameter counts", () => {
		const raw: fc.Arbitrary<QmkRawCommand> = fc.oneof(
			fc.constant({ command: 1 as const, params: [] }),
			fc.record({
				command: fc.constant(7 as const),
				params: fc.array(byte, { minLength: 1, maxLength: 31 }),
			}),
			fc.record({
				command: fc.constant(8 as const),
				params: fc.array(byte, { minLength: 1, maxLength: 1 }),
			}),
			fc.record({ command: fc.constant(9 as const), params: bytes(1) }),
		);
		fc.assert(
			fc.property(raw, (value) => {
				expect(
					right(
						decodeQmkCommand(right(wrapQmkCommand(value)), value.params.length),
					),
				).toEqual(value);
				schemaRoundTrip(qmkCommandReport(value.params.length), value);
			}),
		);
	});
	it("uses modulo FF and preserves checksum under permutation and FF insertion", () => {
		fc.assert(
			fc.property(bytes(1000), (value) => {
				expect(checksum(value)).toBe(
					value.reduce((sum, b) => sum + b, 0) % 255,
				);
				expect(checksum([...value].reverse())).toBe(checksum(value));
				expect(checksum([...value, 255])).toBe(checksum(value));
				expect(checksum(value)).toBeLessThan(255);
			}),
		);
	});
	it("rejects corrupt checksums and every truncated A1/A2/A3 frame", () => {
		fc.assert(
			fc.property(short, (value) => {
				const frame = right(wrapShortCommand(value));
				const corrupt = Uint8Array.from(frame);
				corrupt[corrupt.length - 1] = ((frame.at(-1) ?? 0) + 1) % 255;
				expect(left(unwrapShortCommand(corrupt))._tag).toBe(
					"FrameChecksumMismatch",
				);
				expect(verifyDeviceReport(Array.from(corrupt))).toBe(false);
			}),
		);
		fc.assert(
			fc.property(resource, (value) => {
				const frame = right(wrapResourceFrame(value));
				frame[frame.length - 1] = ((frame.at(-1) ?? 0) + 1) % 255;
				expect(left(unwrapResourceFrame(frame))._tag).toBe(
					"FrameChecksumMismatch",
				);
			}),
		);
		fc.assert(
			fc.property(
				fc
					.jsonValue()
					.map((value) => right(Schema.decodeUnknownEither(JsonValue)(value))),
				(value) => {
					const frame = right(wrapJsonFrame(value));
					frame[frame.length - 1] = ((frame.at(-1) ?? 0) + 1) % 255;
					expect(left(unwrapJsonFrame(frame))._tag).toBe(
						"FrameChecksumMismatch",
					);
				},
			),
		);
		for (const [frame, decode] of [
			[right(wrapShortCommand(dfuCommand())), unwrapShortCommand],
			[right(wrapJsonFrame({ test: true })), unwrapJsonFrame],
			[
				right(
					wrapResourceFrame({
						opCode: 2,
						metadata: [0, 1, 2, 0, 0],
						sequence: 0,
						payload: [1, 2],
					}),
				),
				unwrapResourceFrame,
			],
		] as const) {
			for (let end = 0; end < frame.length; end++)
				expect(Either.isLeft(decode(frame.slice(0, end)))).toBe(true);
		}
	});
});

describe("boundary rejection and error identities", () => {
	it("returns Either results for arbitrary untrusted byte sequences", () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 300 }), (input) => {
				for (const decode of [
					decodeHidReport,
					decodeKeyMatrix,
					unwrapJsonFrame,
					unwrapResourceFrame,
					unwrapShortCommand,
				]) {
					expect(Either.isEither(decode(input))).toBe(true);
				}
				expect(Either.isEither(decodeQmkResponse({ command: 1 }, input))).toBe(
					true,
				);
				expect(verifyDeviceReport(Array.from(input))).toBe(
					Either.isRight(unwrapShortCommand(input)),
				);
			}),
			{ numRuns: 500 },
		);
	});

	it("matches all discovery constants and accepts extra descriptor fields", () => {
		expect(QUAKE_IDENTITY).toEqual({
			usagePage: 0xff60,
			usage: 0x61,
			vendorId: 0x4158,
			productId: 0x514b,
		});
		expect(isQuakeInterface({ ...QUAKE_IDENTITY, path: "/hid" })).toBe(true);
		for (const key of Object.keys(QUAKE_IDENTITY))
			expect(isQuakeInterface({ ...QUAKE_IDENTITY, [key]: 0 })).toBe(false);
		expect(isQuakeInterface(null)).toBe(false);
	});
	it("packs compact frames, excludes padding and rejects nonzero padding", () => {
		const value: ShortCommand = dfuCommand();
		const report = right(encodeHidReport(right(wrapShortCommand(value))));
		expect(report.length).toBe(33);
		expect(report[0]).toBe(0);
		expect(right(unwrapShortCommand(report))).toEqual(value);
		report[32] = 1;
		expect(left(unwrapShortCommand(report))._tag).toBe("FrameSizeInvalid");
		expect(verifyDeviceReport(Array.from(report))).toBe(false);
		for (const payload of [0, 1, 20, 21]) {
			const resource: ResourceEnvelope = {
				opCode: 2,
				metadata: [0, 1, 2, 0, 0],
				sequence: 0,
				payload: new Array<number>(payload).fill(0),
			};
			expect(
				right(
					unwrapResourceFrame(
						right(encodeHidReport(right(wrapResourceFrame(resource)))),
					),
				),
			).toEqual(resource);
		}
		for (const value of ["", "a", { event: true }])
			expect(
				right(
					unwrapJsonFrame(right(encodeHidReport(right(wrapJsonFrame(value))))),
				),
			).toEqual(value);
	});
	it("rejects oversized packing and invalid physical lengths/IDs", () => {
		expect(left(encodeHidReport(new Uint8Array(33)))).toBeInstanceOf(
			FrameSizeInvalid,
		);
		for (const size of [0, 1, 31, 34])
			expect(left(decodeHidReport(new Uint8Array(size)))).toBeInstanceOf(
				FrameSizeInvalid,
			);
		const badId = new Uint8Array(33);
		badId[0] = 1;
		expect(left(decodeHidReport(badId))).toBeInstanceOf(FrameTypeUnsupported);
		expect(left(encodeHidReport([256]))).toBeInstanceOf(ProtocolInputInvalid);
		expect(left(unwrapShortCommand([0xa3, 0, 0]))).toBeInstanceOf(
			FrameSizeInvalid,
		);
		expect(left(unwrapShortCommand([0xa3, 1, 0, 0, 0]))).toBeInstanceOf(
			FrameSizeInvalid,
		);
		expect(left(unwrapShortCommand([0xa3, 2, 1, 2, 3, 0]))).toBeInstanceOf(
			FrameSizeInvalid,
		);
		expect(
			left(wrapShortCommand({ opCode: 256, cmdId: 1, subData: [] })),
		).toBeInstanceOf(ProtocolInputInvalid);
		expect(
			left(
				wrapShortCommand({
					opCode: 1,
					cmdId: 1,
					subData: new Array<number>(254).fill(0),
				}),
			),
		).toBeInstanceOf(ProtocolInputInvalid);
	});
	it("supports full logical length boundaries without silently truncating", () => {
		const text = "a".repeat(65533);
		expect(right(unwrapJsonFrame(right(wrapJsonFrame(text))))).toBe(text);
		expect(left(wrapJsonFrame(`${text}a`))).toBeInstanceOf(FrameSizeInvalid);
		expect(left(encodeHidReport(right(wrapJsonFrame(text))))).toBeInstanceOf(
			FrameSizeInvalid,
		);
		const resource: ResourceEnvelope = {
			opCode: 255,
			metadata: [1, 2, 3, 4, 5],
			sequence: 255,
			payload: new Array<number>(65528).fill(0xff),
		};
		expect(
			right(unwrapResourceFrame(right(wrapResourceFrame(resource)))),
		).toEqual(resource);
		expect(
			left(
				wrapResourceFrame({ ...resource, payload: [...resource.payload, 0] }),
			),
		).toBeInstanceOf(ProtocolInputInvalid);
	});
	it("rejects bad UTF-8, non-JSON values, and JSON errors without payload disclosure", () => {
		for (const data of [[0xff], [0x7b], [0x22, 0xc0, 0xaf, 0x22]]) {
			expect(
				left(unwrapJsonFrame([0xa1, 0, data.length, ...data, checksum(data)])),
			).toBeInstanceOf(ProtocolJsonInvalid);
		}
		for (const value of [NaN, Infinity, { x: undefined }, { x: () => 1 }])
			expect(left(wrapJsonFrame(value as JsonValue))).toBeInstanceOf(
				ProtocolJsonInvalid,
			);
		const cycle: Record<string, JsonValue> = {};
		cycle.self = cycle;
		expect(left(wrapJsonFrame(cycle))).toBeInstanceOf(ProtocolJsonInvalid);
		const sensitive = '{"apiKey":"secret"';
		const data = Array.from(new TextEncoder().encode(sensitive));
		const error = left(
			unwrapJsonFrame([0xa1, 0, data.length, ...data, checksum(data)]),
		);
		expect(error._tag).toBe("ProtocolJsonInvalid");
		if (error._tag !== "ProtocolJsonInvalid") return;
		expect(error.originalCause).toBeInstanceOf(SyntaxError);
		expect(
			Object.getOwnPropertyDescriptor(error, "originalCause")?.enumerable,
		).toBe(false);
		expect(JSON.stringify(error)).not.toContain("secret");
		expect(JSON.stringify(error)).not.toContain("apiKey");
		expect(JSON.stringify(error)).not.toContain("originalCause");
	});
	it("validates QMK response identity and length before extracting values", () => {
		expect(left(decodeQmkResponse({ command: 1 }, [1, 0]))).toBeInstanceOf(
			FrameSizeInvalid,
		);
		expect(left(decodeQmkResponse({ command: 1 }, [9, 0, 1]))).toBeInstanceOf(
			QmkResponseMismatch,
		);
		expect(
			left(
				decodeQmkResponse(
					{ command: 8, lightingValue: 9, resultLength: 2 },
					[8, 9, 1],
				),
			),
		).toBeInstanceOf(FrameSizeInvalid);
		expect(
			left(
				decodeQmkResponse(
					{ command: 8, lightingValue: 9, resultLength: 1 },
					[8, 10, 1],
				),
			),
		).toBeInstanceOf(QmkResponseMismatch);
		expect(
			left(
				decodeQmkResponse(
					{ command: 7, lightingValue: 9, values: [1] },
					[7, 9, 2],
				),
			),
		).toBeInstanceOf(QmkResponseMismatch);
		expect(
			left(decodeQmkResponse({ command: 9, channelId: 3 }, [9, 4])),
		).toBeInstanceOf(QmkResponseMismatch);
		const report = right(encodeHidReport([1, 0x12, 0x34]));
		expect(right(decodeQmkResponse({ command: 1 }, report))).toEqual({
			command: 1,
			version: 0x1234,
		});
		expect(left(decodeKeyMatrix(new Uint8Array(32)))).toBeInstanceOf(
			FrameTypeUnsupported,
		);
	});
	it("catalog leaves retain identity and scrub all original causes", () => {
		const cause = { message: "token=secret", cause: { password: "secret" } };
		const errors = [
			new ProtocolInputInvalid(cause),
			new ProtocolJsonInvalid(cause),
			new FrameSizeInvalid(2, 3),
			new FrameChecksumMismatch(),
			new FrameTypeUnsupported(),
			new QmkResponseMismatch(),
		];
		for (const error of errors) {
			const entry = ProtocolErrors[error._tag];
			expect(error.code).toBe(entry.code);
			expect(error.category).toBe(entry.category);
			expect(error.message).toBe(entry.message);
			expect(entry.policy.retry).toBe("never");
			expect(JSON.stringify(error)).not.toContain("secret");
		}
		expect(new ProtocolInputInvalid(cause).originalCause).toBe(cause);
	});
});
