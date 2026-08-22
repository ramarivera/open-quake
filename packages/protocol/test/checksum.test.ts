import { describe, expect, it } from "@effect/vitest";
import * as fc from "fast-check";
import { checksum, frameHostCommand } from "../src/checksum.js";

describe("checksum (byte-sum mod 0xFF)", () => {
	it("matches the keep-alive vector from the firmware protocol docs", () => {
		// Host -> device: [0xA3, payloadLen+1, flag, ...payload, checksum]
		// KEEP_ALIVE ping: cmdID 0xEF, flag 2 => checksum = (2 + 0xEF) % 0xFF = 0xF1
		expect(Array.from(frameHostCommand(2, [0xef]))).toEqual([
			0xa3, 2, 2, 0xef, 0xf1,
		]);
	});

	it("property: framed output is [A3, len+1, flag, ...payload, checksum] with a valid trailing checksum", () => {
		const arbPayload = fc.array(fc.nat({ max: 255 }), { maxLength: 64 });
		const arbFlag = fc.nat({ max: 255 });
		fc.assert(
			fc.property(arbFlag, arbPayload, (flag, payload) => {
				const frame = Array.from(frameHostCommand(flag, payload));
				const flagByte = frame[2] ?? 0;
				expect(frame[0]).toBe(0xa3);
				expect(frame[1]).toBe(payload.length + 1);
				expect(flagByte).toBe(flag & 0xff);
				expect(frame.slice(3, -1)).toEqual(payload.map((b) => b & 0xff));
				expect(frame.at(-1)).toBe(checksum([flagByte, ...payload]));
			}),
		);
	});
});
