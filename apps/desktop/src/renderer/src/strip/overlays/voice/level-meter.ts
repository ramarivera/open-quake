import { STRIP_PALETTE } from "../../palette";

/**
 * The mic level meter (independent-device-design, "Voice and AI surfaces"):
 * a row of rounded bars that rise with the real, smoothed mic level. The
 * smoothing is strip-voice-ui's "Mic mountain bar" rule; only the drawing
 * changed. Geometry is pure; `drawLevelMeter` paints one frame.
 */
export const BAR_WIDTH = 1920;
export const BAR_HEIGHT = 72;
export const BAR_ROW_HEIGHT = 52;
export const METER_BARS = 41;
export const METER_BAR_WIDTH = 8;
export const METER_BAR_GAP = 10;
/** The resting bar: visible, but clearly "no level". */
export const METER_MIN = 6;

export interface BarMotion {
	readonly display: number;
	readonly phase: number;
}
export const initialBarMotion: BarMotion = { display: 0, phase: 0 };

/** One animation frame of smoothing toward the latest real level. */
export function stepBarMotion(
	motion: BarMotion,
	rms: number,
	speaking: boolean,
): BarMotion {
	const target = speaking ? rms : rms * 0.2;
	let display = motion.display + (target - motion.display) * 0.28;
	if (!speaking && display < 0.004) display = 0;
	return { display, phase: motion.phase + 0.11 + display * 0.08 };
}

/** Bar heights, tallest in the middle; all METER_MIN at zero level. */
export function meterHeights(height: number, motion: BarMotion): number[] {
	const energy = Math.max(0, Math.min(1, motion.display));
	const top = height - 12;
	const middle = (METER_BARS - 1) / 2;
	return Array.from({ length: METER_BARS }, (_, index) => {
		const distance = Math.abs(index - middle) / middle;
		const envelope = 1 - distance * distance * 0.7;
		const ripple = 0.72 + 0.28 * Math.sin(motion.phase * 1.7 + index * 0.9);
		const value = METER_MIN + energy * (top - METER_MIN) * envelope * ripple;
		return Math.max(METER_MIN, Math.min(top, value));
	});
}

export type MeterCanvas = Pick<
	CanvasRenderingContext2D,
	"clearRect" | "fillRect" | "fillStyle" | "setTransform"
>;

export function drawLevelMeter(
	ctx: MeterCanvas,
	width: number,
	height: number,
	motion: BarMotion,
): void {
	ctx.clearRect(0, 0, width, height);
	const heights = meterHeights(height, motion);
	const total = METER_BARS * METER_BAR_WIDTH + (METER_BARS - 1) * METER_BAR_GAP;
	const left = (width - total) / 2;
	ctx.fillStyle =
		motion.display > 0 ? STRIP_PALETTE.accent : STRIP_PALETTE.line;
	heights.forEach((bar, index) => {
		ctx.fillRect(
			left + index * (METER_BAR_WIDTH + METER_BAR_GAP),
			(height - bar) / 2,
			METER_BAR_WIDTH,
			bar,
		);
	});
}
