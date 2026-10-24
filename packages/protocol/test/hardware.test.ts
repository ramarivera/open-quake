import { describe, expect, it } from "@effect/vitest";
import { Either, Option, Schema } from "effect";
import * as fc from "fast-check";
import { decodeHidReport } from "../src/framing.js";
import {
	HardwareCommand as Commands,
	decodeHardwareCommand,
	decodeHardwareFrame,
	encodeHardwareCommand,
	type HardwareCommand,
	hardwareShortCommand,
} from "../src/hardware.js";
import { unwrapShortCommand } from "../src/short-command.js";

const right = <A, E>(e: Either.Either<A, E>): A => {
	if (Either.isLeft(e)) throw e.left;
	return e.right;
};
const report = (compact: readonly number[]) => [
	...compact,
	...Array<number>(33 - compact.length).fill(0),
];
const fixtures: readonly (readonly [HardwareCommand, readonly number[]])[] = [
	[{ _tag: "Buzzer", level: 84 }, [0, 0xa3, 3, 1, 2, 84, 87]],
	[{ _tag: "Buzzer", level: 0 }, [0, 0xa3, 3, 1, 2, 0, 3]],
	[{ _tag: "Mic", on: false }, [0, 0xa3, 3, 1, 3, 0, 4]],
	[{ _tag: "Mic", on: true }, [0, 0xa3, 3, 1, 3, 1, 5]],
	[{ _tag: "ScreenPower", on: false }, [0, 0xa3, 3, 1, 4, 0, 5]],
	[{ _tag: "ScreenPower", on: true }, [0, 0xa3, 3, 1, 4, 1, 6]],
	[{ _tag: "Luminance", value: 255 }, [0, 0xa3, 3, 1, 5, 255, 6]],
	[{ _tag: "Luminance", value: 25 }, [0, 0xa3, 3, 1, 5, 25, 31]],
	[{ _tag: "KnobLed", on: false }, [0, 0xa3, 3, 1, 6, 0, 7]],
	[{ _tag: "KnobLed", on: true }, [0, 0xa3, 3, 1, 6, 1, 8]],
	[
		{ _tag: "Keyboard", action: 1, modifiers: 5, usage: 4 },
		[0, 0xa3, 5, 1, 16, 1, 5, 4, 27],
	],
	[
		{ _tag: "Keyboard", action: 0, modifiers: 5, usage: 4 },
		[0, 0xa3, 5, 1, 16, 0, 5, 4, 26],
	],
	[
		{ _tag: "Keyboard", action: 2, modifiers: 0, usage: 82 },
		[0, 0xa3, 5, 1, 16, 2, 0, 82, 101],
	],
	[{ _tag: "Query", feature: "mic" }, [0, 0xa3, 2, 2, 3, 5]],
	[{ _tag: "Query", feature: "luminance" }, [0, 0xa3, 2, 2, 5, 7]],
	[{ _tag: "Query", feature: "version" }, [0, 0xa3, 2, 2, 46, 48]],
];
describe("hardware golden reports", () => {
	it.each(fixtures)("encodes %j", (command, golden) => {
		const bytes = right(encodeHardwareCommand(command));
		expect([...bytes]).toEqual(report(golden));
		expect(right(decodeHardwareCommand(bytes))).toEqual(command);
		expect(right(unwrapShortCommand(right(decodeHidReport(bytes))))).toEqual(
			hardwareShortCommand(command),
		);
	});
	it.each([
		[[0xa3, 3, 0x55, 0, 0x90, 0xe5], { _tag: "Ack", status: 0x90 }],
		[[0xa3, 3, 0x55, 3, 1, 89], { _tag: "MicState", on: true }],
		[[0xa3, 3, 0x55, 5, 255, 90], { _tag: "LuminanceState", value: 255 }],
		[
			[0xa3, 6, 0x55, 46, 1, 1, 0, 21, 154],
			{ _tag: "FirmwareVersion", deviceName: 1, major: 1, minor: 0, patch: 21 },
		],
	])("decodes independent reply %j", (bytes, expected) => {
		expect(right(decodeHardwareFrame(bytes))).toEqual(Option.some(expected));
	});
	it("rejects malformed and invalid known data, ignores unknown commands", () => {
		for (const bytes of [
			[0xa3, 2, 85, 3, 88],
			[0xa3, 3, 85, 3, 2, 90],
			[0xa3, 3, 85, 46, 1, 132],
		])
			expect(Either.isLeft(decodeHardwareFrame(bytes))).toBe(true);
		expect(right(decodeHardwareFrame([0xa3, 2, 85, 99, 184]))).toEqual(
			Option.none(),
		);
		for (const input of [
			{ _tag: "Luminance", value: 24 },
			{ _tag: "Buzzer", level: 31 },
			{ _tag: "Keyboard", action: 3, modifiers: 0, usage: 4 },
			{ _tag: "Keyboard", action: 1, modifiers: 256, usage: 4 },
		])
			expect(Either.isLeft(Schema.decodeUnknownEither(Commands)(input))).toBe(
				true,
			);
	});
	it("preserves arbitrary valid keyboard bytes and checksums", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 2 }),
				fc.integer({ min: 0, max: 255 }),
				fc.integer({ min: 0, max: 255 }),
				(action, modifiers, usage) => {
					const command = right(
						Schema.decodeUnknownEither(Commands)({
							_tag: "Keyboard",
							action,
							modifiers,
							usage,
						}),
					);
					expect(
						right(
							unwrapShortCommand(
								right(decodeHidReport(right(encodeHardwareCommand(command)))),
							),
						),
					).toEqual({
						opCode: 1,
						cmdId: 16,
						subData: [action, modifiers, usage],
					});
				},
			),
		);
	});
});
