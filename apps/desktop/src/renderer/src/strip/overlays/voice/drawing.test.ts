import { FastCheck as fc } from "effect";
import { describe, expect, it } from "vitest";
import {
	BAR_HEIGHT,
	BAR_WIDTH,
	barGeometry,
	drawMountainBar,
	initialBarMotion,
	orbHues,
	spikes,
	stepBarMotion,
} from "./mountain-bar";
import {
	drawWaveform,
	type StripCanvas,
	WAVES,
	wavePoints,
	wavesInDrawOrder,
} from "./waveform";

/** Counts canvas calls; gradients accept stops and ignore them. */
function recordingCanvas() {
	const calls = new Map<string, number>();
	const count = (name: string) => () => {
		calls.set(name, (calls.get(name) ?? 0) + 1);
	};
	const gradient = { addColorStop: () => undefined };
	const ctx: StripCanvas = {
		arc: count("arc"),
		beginPath: count("beginPath"),
		clearRect: count("clearRect"),
		createLinearGradient: () => gradient,
		ellipse: count("ellipse"),
		fillRect: count("fillRect"),
		lineTo: count("lineTo"),
		moveTo: count("moveTo"),
		quadraticCurveTo: count("quadraticCurveTo"),
		restore: count("restore"),
		save: count("save"),
		setTransform: count("setTransform"),
		stroke: count("stroke"),
		fillStyle: "",
		globalAlpha: 1,
		lineWidth: 1,
		shadowBlur: 0,
		shadowColor: "",
		strokeStyle: "",
	};
	return { ctx, calls };
}

describe("waveform backdrop", () => {
	it("samples 241 points and stays within each wave's amplitude and drift", () => {
		fc.assert(
			fc.property(fc.double({ min: 0, max: 1e4, noNaN: true }), (t) => {
				for (const wave of WAVES) {
					const points = wavePoints(wave, t, 1920, 480);
					expect(points).toHaveLength(241);
					for (const point of points)
						expect(Math.abs(point.y - 240)).toBeLessThanOrEqual(
							480 * (wave.amp + 0.015) + 1e-9,
						);
				}
			}),
		);
	});

	it("draws brightest first, with 200–300 noise dots and two passes per wave", () => {
		expect(wavesInDrawOrder()[0]?.thickness).toBe(4.0);
		const { ctx, calls } = recordingCanvas();
		drawWaveform(ctx, 1920, 480, 0, () => 0.5);
		// One background fill plus 250 dots.
		expect(calls.get("fillRect")).toBe(251);
		expect(calls.get("stroke")).toBe(10);
	});
});

describe("mic mountain bar", () => {
	it("uses DK's orb radius and hue sweep", () => {
		expect(barGeometry(BAR_WIDTH, BAR_HEIGHT, 0).orbRadius).toBeCloseTo(25.92);
		const hues = orbHues();
		expect(hues).toHaveLength(72);
		expect(Math.min(...hues)).toBeGreaterThanOrEqual(185);
		expect(Math.max(...hues)).toBeLessThanOrEqual(300);
	});

	it("keeps spikes inside the spread and under maxAmp for any level", () => {
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
						const geometry = barGeometry(BAR_WIDTH, BAR_HEIGHT, motion.display);
						for (const side of ["left", "right"] as const)
							for (const spike of spikes(geometry, motion.phase, side)) {
								expect(spike.amp).toBeLessThanOrEqual(geometry.maxAmp + 1e-9);
								expect(Math.abs(spike.x - geometry.cx)).toBeLessThanOrEqual(
									geometry.orbRadius + geometry.spread + 1e-9,
								);
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
		for (let i = 0; i < 30; i++) motion = stepBarMotion(motion, 0.8, true);
		expect(motion.display).toBeGreaterThan(0.79);
		expect(barGeometry(BAR_WIDTH, BAR_HEIGHT, 1).spread).toBeCloseTo(
			25.92 * 0.4 + 1920 * 0.19,
		);
	});

	it("draws background, grid, ripples, spikes and 72 orb arcs", () => {
		const { ctx, calls } = recordingCanvas();
		drawMountainBar(ctx, BAR_WIDTH, BAR_HEIGHT, { display: 0.6, phase: 1 });
		expect(calls.get("ellipse")).toBe(3);
		expect(calls.get("arc")).toBe(73);
	});
});
