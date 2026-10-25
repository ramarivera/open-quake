import { FastCheck as fc } from "effect";
import { describe, expect, it } from "vitest";
import { STRIP_PALETTE } from "../../palette";
import {
	BAR_HEIGHT,
	BAR_WIDTH,
	drawLevelMeter,
	initialBarMotion,
	METER_BARS,
	METER_MIN,
	type MeterCanvas,
	meterHeights,
	stepBarMotion,
} from "./level-meter";

function recordingCanvas() {
	const rects: [number, number, number, number][] = [];
	const ctx: MeterCanvas & { fills: string[] } = {
		clearRect: () => undefined,
		setTransform: () => undefined,
		fillRect: (x, y, width, height) => {
			rects.push([x, y, width, height]);
			ctx.fills.push(String(ctx.fillStyle));
		},
		fillStyle: "",
		fills: [],
	};
	return { ctx, rects };
}

describe("mic level meter", () => {
	it("keeps every bar inside the meter for any real level sequence", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.boolean()),
					{ maxLength: 60 },
				),
				(levels) => {
					let motion = initialBarMotion;
					for (const [rms, speaking] of levels) {
						motion = stepBarMotion(motion, rms, speaking);
						expect(motion.display).toBeGreaterThanOrEqual(0);
						expect(motion.display).toBeLessThanOrEqual(1);
						for (const bar of meterHeights(BAR_HEIGHT, motion)) {
							expect(bar).toBeGreaterThanOrEqual(METER_MIN);
							expect(bar).toBeLessThanOrEqual(BAR_HEIGHT - 12);
						}
					}
				},
			),
		);
	});

	it("settles silence to zero and opens with speech", () => {
		let motion = { display: 0.003, phase: 0 };
		motion = stepBarMotion(motion, 0, false);
		expect(motion.display).toBe(0);
		expect(new Set(meterHeights(BAR_HEIGHT, motion))).toEqual(
			new Set([METER_MIN]),
		);
		for (let i = 0; i < 30; i++) motion = stepBarMotion(motion, 0.8, true);
		expect(motion.display).toBeGreaterThan(0.79);
		const heights = meterHeights(BAR_HEIGHT, motion);
		expect(Math.max(...heights)).toBeGreaterThan(30);
	});

	it("draws centred bars: line colour at rest, accent with a level", () => {
		const rest = recordingCanvas();
		drawLevelMeter(rest.ctx, BAR_WIDTH, BAR_HEIGHT, initialBarMotion);
		expect(rest.rects).toHaveLength(METER_BARS);
		expect(rest.ctx.fills.every((fill) => fill === STRIP_PALETTE.line)).toBe(
			true,
		);
		const first = rest.rects[0];
		const last = rest.rects.at(-1);
		expect(first && last && first[0] + (last[0] + last[2])).toBeCloseTo(
			BAR_WIDTH,
		);
		const live = recordingCanvas();
		drawLevelMeter(live.ctx, BAR_WIDTH, BAR_HEIGHT, {
			display: 0.6,
			phase: 1,
		});
		expect(live.ctx.fills.every((fill) => fill === STRIP_PALETTE.accent)).toBe(
			true,
		);
	});
});
