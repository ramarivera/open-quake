import { describe, expect, it } from "@effect/vitest";
import { FastCheck, Option } from "effect";
import {
	isTouchDevice,
	TOUCH_IDENTITY,
} from "../../src/touch/touch-contracts.js";
import { SYNTHETIC_TOUCH_DOWN } from "../../src/touch/touch-fixtures.js";
import {
	createTouchTracker,
	parseTouchReport,
	touchRecoveryDelay,
} from "../../src/touch/touch-invariants.js";

const coord = FastCheck.integer({ min: 0, max: 65535 });
const raw = (x: number, y: number, action = 1) => ({ x, y, action });
describe("source-derived vendor frames", () => {
	it.prop(
		"decodes little-endian coordinates without inferring a checksum",
		[coord, coord, FastCheck.integer({ min: 0, max: 255 })],
		([x, y, action]) => {
			const parsed = parseTouchReport(
				Uint8Array.from([
					0xa3,
					255,
					13,
					0x1a,
					1,
					action,
					y & 255,
					y >> 8,
					x & 255,
					x >> 8,
					117,
				]),
			);
			expect(parsed).toEqual(Option.some([raw(x, y, action)]));
		},
	);
	it("rejects every truncation and malformed headers/counts, accepts empty frames", () => {
		for (let length = 0; length < SYNTHETIC_TOUCH_DOWN.length; length++)
			expect(
				Option.isNone(parseTouchReport(SYNTHETIC_TOUCH_DOWN.slice(0, length))),
			).toBe(true);
		for (const bytes of [
			[0xa2, 0, 0, 0x1a, 0],
			[0xa3, 0, 0, 1, 0],
			[0xa3, 0, 0, 0x1a, 6, ...Array<number>(30).fill(0)],
		])
			expect(Option.isNone(parseTouchReport(Uint8Array.from(bytes)))).toBe(
				true,
			);
		expect(parseTouchReport(Uint8Array.from([0xa3, 0, 0, 0x1a, 0]))).toEqual(
			Option.some([]),
		);
	});
	it.prop(
		"never reads past a declared complete bounded frame",
		[FastCheck.uint8Array({ maxLength: 100 })],
		([bytes]) => {
			const decoded = parseTouchReport(bytes);
			if (Option.isSome(decoded)) {
				expect(decoded.value.length).toBeLessThanOrEqual(5);
				expect(bytes.length).toBeGreaterThanOrEqual(
					5 + decoded.value.length * 5,
				);
			}
		},
	);
	it("selects all four fields, rejecting the attached unit's other usages", () => {
		const touch = { path: "fake:touch", ...TOUCH_IDENTITY };
		expect(isTouchDevice(touch)).toBe(true);
		for (const [usagePage, usage] of [
			[0x0d, 4],
			[0xff00, 1],
			[1, 2],
			[1, 1],
		])
			expect(
				isTouchDevice({
					...touch,
					usagePage: usagePage ?? 0,
					usage: usage ?? 0,
				}),
			).toBe(false);
		for (const key of ["vendorId", "productId", "usagePage", "usage"] as const)
			expect(isTouchDevice({ ...touch, [key]: touch[key] + 1 })).toBe(false);
		expect(isTouchDevice({ ...touch, path: "" })).toBe(false);
	});
	it("uses presence despite raw action zero, preserves 99px IDs and lifts replacements", () => {
		const tracker = createTouchTracker();
		expect(tracker.frame([raw(0, 0, 0)])).toEqual([
			{ ...raw(0, 0), touchId: "touch-1" },
		]);
		expect(tracker.frame([raw(99, 0)])[0]?.touchId).toBe("touch-1");
		expect(tracker.frame([raw(199, 0)])).toEqual([
			{ ...raw(99, 0, 0), touchId: "touch-1" },
			{ ...raw(199, 0), touchId: "touch-2" },
		]);
		expect(tracker.release()).toEqual([
			{ ...raw(199, 0, 0), touchId: "touch-2" },
		]);
		expect(tracker.release()).toEqual([]);
		expect(tracker.frame([raw(199, 0)])[0]?.touchId).toBe("touch-3");
	});
	it.prop(
		"matches each new contact once even when contacts collide",
		[
			FastCheck.array(
				FastCheck.record({ x: coord, y: coord, action: FastCheck.constant(1) }),
				{ maxLength: 5 },
			),
		],
		([points]) => {
			const tracker = createTouchTracker();
			tracker.frame(points);
			const second = tracker
				.frame(points)
				.filter((point) => point.action === 1);
			expect(second).toHaveLength(points.length);
			expect(new Set(second.map((point) => point.touchId)).size).toBe(
				second.length,
			);
			expect(tracker.frame([]).every((point) => point.action === 0)).toBe(true);
		},
	);
	it("caps recovery and applies the empty-enumeration floor", () => {
		expect(
			[0, 1, 2, 3, 4, 99].map((cycle) => touchRecoveryDelay(cycle, false)),
		).toEqual([10000, 15000, 20000, 25000, 30000, 30000]);
		expect(touchRecoveryDelay(0, true)).toBe(60000);
	});
});
