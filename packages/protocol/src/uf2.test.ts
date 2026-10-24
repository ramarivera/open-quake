import { Either, FastCheck as fc } from "effect";
import { describe, expect, it } from "vitest";
import { encodeHardwareCommand } from "./hardware.js";
import { inspectUf2 } from "./uf2.js";
import { syntheticUf2 } from "./uf2-fixtures.js";

describe("trusted-image structural prerequisite", () => {
	it("accepts standard newline magic and independently generated block geometry", () => {
		expect(inspectUf2(syntheticUf2())).toEqual(
			Either.right({
				blocks: 2,
				payloadBytes: 512,
				start: 0x12000,
				end: 0x121ff,
				family: 0x1aa143c7,
			}),
		);
	});
	it.each([
		[0, 0x00324655, "magic"],
		[4, 0, "magic"],
		[508, 0, "magic"],
		[8, 0, "flags"],
		[28, 1, "family"],
		[20, 9, "block"],
		[24, 9, "block"],
		[16, 477, "payload"],
		[12, 0xffffffff, "payload"],
	])("rejects mutated field %s", (field, value, reason) => {
		const bytes = syntheticUf2();
		new DataView(bytes.buffer).setUint32(Number(field), Number(value), true);
		expect(inspectUf2(bytes)).toEqual(Either.left(reason));
	});
	it("rejects overlaps and duplicate block numbers", () => {
		const bytes = syntheticUf2();
		const view = new DataView(bytes.buffer);
		view.setUint32(512 + 12, 0x12000, true);
		expect(inspectUf2(bytes)).toEqual(Either.left("overlap"));
		view.setUint32(512 + 20, 0, true);
		expect(inspectUf2(bytes)).toEqual(Either.left("block"));
	});
	it("accepts arbitrary complete nonoverlapping synthetic block counts", () =>
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 64 }), (count) => {
				expect(Either.isRight(inspectUf2(syntheticUf2(count)))).toBe(true);
			}),
		));
	it("reuses the known DFU encoder without IO", () => {
		const result = encodeHardwareCommand({ _tag: "Dfu" });
		expect(Either.isRight(result)).toBe(true);
		if (Either.isRight(result))
			expect([...result.right.slice(0, 7)]).toEqual([
				0, 0xa3, 3, 1, 0x2f, 3, 0x33,
			]);
	});
});
