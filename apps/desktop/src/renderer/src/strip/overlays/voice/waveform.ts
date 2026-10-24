/**
 * DK-Suite's WaveformView backdrop (WFV:19-264): five glowing sine waves on
 * near-black. Geometry is pure; `drawWaveform` paints one frame.
 */
export interface Wave {
	readonly amp: number;
	readonly freq: number;
	readonly speed: number;
	readonly thickness: number;
	readonly opacity: number;
	readonly glow: number;
	readonly phase: number;
}
export const WAVES: readonly Wave[] = [
	{
		amp: 0.18,
		freq: 1.2,
		speed: 0.45,
		thickness: 4.0,
		opacity: 0.95,
		glow: 22,
		phase: 0,
	},
	{
		amp: 0.26,
		freq: 0.9,
		speed: 0.38,
		thickness: 2.5,
		opacity: 0.55,
		glow: 14,
		phase: Math.PI * 0.35,
	},
	{
		amp: 0.22,
		freq: 1.05,
		speed: 0.42,
		thickness: 2.0,
		opacity: 0.5,
		glow: 12,
		phase: Math.PI * 0.7,
	},
	{
		amp: 0.32,
		freq: 0.7,
		speed: 0.33,
		thickness: 1.6,
		opacity: 0.35,
		glow: 10,
		phase: Math.PI * 1.1,
	},
	{
		amp: 0.14,
		freq: 1.7,
		speed: 0.52,
		thickness: 1.2,
		opacity: 0.3,
		glow: 8,
		phase: Math.PI * 1.7,
	},
];
export const WAVE_PALETTE = ["#b8fff6", "#17f1d1", "#7ffff0"] as const;
export const WAVE_BACKGROUND = "#050807D9";
const SAMPLING_STEPS = 240;
const DRIFT_AMPLITUDE = 0.015;
const DRIFT_FREQ = 0.18;
const GLOW_MULTIPLIER = 1.8;
const CORE_GLOW_RATIO = 0.4;
/** Time advances by this per animation frame (≈60 fps). */
export const WAVE_TIME_STEP = 0.016;

export interface Point {
	readonly x: number;
	readonly y: number;
}

/** Brightest first: sorted by thickness × opacity, descending (WFV:243-248). */
export const wavesInDrawOrder = (): readonly Wave[] =>
	[...WAVES].sort((a, b) => b.thickness * b.opacity - a.thickness * a.opacity);

/** 241 samples across the width; intensity is fixed at 1.0 (KNOB-062). */
export function wavePoints(
	wave: Wave,
	t: number,
	width: number,
	height: number,
): readonly Point[] {
	const step = width / SAMPLING_STEPS;
	const drift =
		Math.sin(t * DRIFT_FREQ + wave.phase) * height * DRIFT_AMPLITUDE;
	const base = height / 2 + drift;
	return Array.from({ length: SAMPLING_STEPS + 1 }, (_, index) => {
		const x = index * step;
		return {
			x,
			y:
				base +
				height *
					wave.amp *
					Math.sin(
						2 * Math.PI * ((x / width) * wave.freq + t * wave.speed) +
							wave.phase,
					),
		};
	});
}

/** The subset of CanvasRenderingContext2D the strip canvases use. */
export type StripCanvas = Pick<
	CanvasRenderingContext2D,
	| "arc"
	| "beginPath"
	| "clearRect"
	| "createLinearGradient"
	| "ellipse"
	| "fillRect"
	| "lineTo"
	| "moveTo"
	| "quadraticCurveTo"
	| "restore"
	| "save"
	| "setTransform"
	| "stroke"
	| "fillStyle"
	| "globalAlpha"
	| "lineWidth"
	| "shadowBlur"
	| "shadowColor"
	| "strokeStyle"
>;

function smoothPath(ctx: StripCanvas, points: readonly Point[]): void {
	const first = points[0];
	const last = points.at(-1);
	if (!first || !last) return;
	ctx.beginPath();
	ctx.moveTo(first.x, first.y);
	for (let index = 1; index < points.length - 1; index++) {
		const current = points[index];
		const next = points[index + 1];
		if (!current || !next) continue;
		ctx.quadraticCurveTo(
			current.x,
			current.y,
			(current.x + next.x) / 2,
			(current.y + next.y) / 2,
		);
	}
	ctx.lineTo(last.x, last.y);
}

/** One frame: 85 % near-black, 200–300 noise dots, then glow and core passes. */
export function drawWaveform(
	ctx: StripCanvas,
	width: number,
	height: number,
	t: number,
	random: () => number,
): void {
	ctx.clearRect(0, 0, width, height);
	ctx.fillStyle = WAVE_BACKGROUND;
	ctx.fillRect(0, 0, width, height);
	ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
	const dots = Math.floor(random() * 100) + 200;
	for (let index = 0; index < dots; index++)
		ctx.fillRect(random() * width, random() * height, 1, 1);
	const gradient = ctx.createLinearGradient(0, 0, width, 0);
	gradient.addColorStop(0, WAVE_PALETTE[0]);
	gradient.addColorStop(0.5, WAVE_PALETTE[1]);
	gradient.addColorStop(1, WAVE_PALETTE[2]);
	for (const wave of wavesInDrawOrder()) {
		const points = wavePoints(wave, t, width, height);
		ctx.save();
		ctx.lineWidth = wave.thickness * GLOW_MULTIPLIER;
		ctx.shadowBlur = wave.glow;
		ctx.shadowColor = WAVE_PALETTE[1];
		ctx.strokeStyle = gradient;
		smoothPath(ctx, points);
		ctx.globalAlpha = wave.opacity * 0.8;
		ctx.stroke();
		ctx.lineWidth = wave.thickness;
		ctx.shadowBlur = wave.glow * CORE_GLOW_RATIO;
		ctx.globalAlpha = wave.opacity * 0.9;
		ctx.stroke();
		ctx.restore();
	}
}
