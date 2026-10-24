import type { StripCanvas } from "./waveform";

/**
 * DK-Suite's SttVoiceMountainBar (SMB:133-305): a hollow cyan→magenta orb
 * with spike waves that open with the real mic level. Geometry is pure.
 */
export const BAR_WIDTH = 1920;
/** max(48, waveHeight 72) (SMB:62-64). */
export const BAR_HEIGHT = 72;
export const BAR_ROW_HEIGHT = 52;

export interface BarMotion {
	readonly display: number;
	readonly phase: number;
}
export const initialBarMotion: BarMotion = { display: 0, phase: 0 };

/** One animation frame of smoothing (SMB:137-145). */
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

export interface BarGeometry {
	readonly cx: number;
	readonly cy: number;
	readonly orbRadius: number;
	readonly energy: number;
	readonly spread: number;
	readonly maxAmp: number;
}
export function barGeometry(
	width: number,
	height: number,
	display: number,
): BarGeometry {
	const orbRadius = Math.min(height * 0.36, width * 0.03);
	const energy = Math.max(0, Math.min(1, display));
	return {
		cx: width / 2,
		cy: height / 2,
		orbRadius,
		energy,
		spread: orbRadius * 0.4 + energy * width * 0.19,
		maxAmp: height * 0.08 + energy * height * 0.42,
	};
}

export interface Spike {
	readonly x: number;
	readonly amp: number;
	readonly t: number;
}
/** Spikes every 5 px from the orb's 9 or 3 o'clock point outward (SMB:222-274). */
export function spikes(
	geometry: BarGeometry,
	phase: number,
	side: "left" | "right",
): readonly Spike[] {
	const sign = side === "left" ? -1 : 1;
	const anchor = geometry.cx + sign * geometry.orbRadius;
	const count = Math.max(1, Math.floor(geometry.spread / 5));
	const result: Spike[] = [];
	for (let index = 0; index <= count; index++) {
		const t = index / count;
		const envelope = Math.sin(t * Math.PI);
		const wobble =
			0.5 +
			0.5 * Math.sin(phase * 2.4 + index * 0.92 + (side === "left" ? 0 : 2.1));
		const amp =
			envelope * geometry.maxAmp * wobble * (0.25 + geometry.energy * 0.75);
		if (amp >= 0.6)
			result.push({ x: anchor + sign * geometry.spread * t, amp, t });
	}
	return result;
}

/** 72 arcs, hue 185→300 by cos of the mid angle (SMB:275-305). */
export function orbHues(): readonly number[] {
	return Array.from({ length: 72 }, (_, index) => {
		const mid = ((index + 0.5) / 72) * Math.PI * 2;
		return 185 + ((Math.cos(mid) + 1) / 2) * 115;
	});
}

export function drawMountainBar(
	ctx: StripCanvas,
	width: number,
	height: number,
	motion: BarMotion,
): void {
	const g = barGeometry(width, height, motion.display);
	ctx.clearRect(0, 0, width, height);
	const background = ctx.createLinearGradient(0, 0, 0, height);
	background.addColorStop(0, "rgba(0, 0, 0, 0)");
	background.addColorStop(0.55, "rgba(4, 10, 28, 0.35)");
	background.addColorStop(1, "rgba(0, 0, 0, 0.55)");
	ctx.fillStyle = background;
	ctx.fillRect(0, 0, width, height);
	ctx.save();
	ctx.strokeStyle = "rgba(0, 180, 255, 0.06)";
	ctx.lineWidth = 1;
	for (let x = g.cx % 28; x < width; x += 28) {
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, height);
		ctx.stroke();
	}
	for (let y = 0; y < height; y += 28) {
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(width, y);
		ctx.stroke();
	}
	ctx.restore();
	for (let index = 0; index < 3; index++) {
		const t = index / 3;
		ctx.beginPath();
		ctx.ellipse(
			g.cx,
			g.cy + g.orbRadius * 0.55,
			g.orbRadius * (1.15 + t * 1.6),
			g.orbRadius * (0.22 + t * 0.18),
			0,
			0,
			Math.PI * 2,
		);
		ctx.strokeStyle = `rgba(0, 220, 255, ${0.22 - t * 0.06})`;
		ctx.lineWidth = 1;
		ctx.stroke();
	}
	for (const side of ["left", "right"] as const) {
		const left = side === "left";
		const sign = left ? -1 : 1;
		const anchor = g.cx + sign * g.orbRadius;
		ctx.save();
		ctx.beginPath();
		ctx.moveTo(anchor, g.cy);
		ctx.lineTo(anchor + sign * g.spread, g.cy);
		ctx.strokeStyle = left
			? "rgba(0, 230, 255, 0.55)"
			: "rgba(220, 100, 255, 0.55)";
		ctx.lineWidth = 1;
		ctx.stroke();
		for (const spike of spikes(g, motion.phase, side)) {
			const fade = 1 - spike.t * 0.35;
			const gradient = ctx.createLinearGradient(
				spike.x,
				g.cy - spike.amp,
				spike.x,
				g.cy + spike.amp,
			);
			const [edge, core] = left
				? ["120, 255, 255", "0, 200, 255"]
				: ["255, 140, 255", "200, 80, 255"];
			gradient.addColorStop(0, `rgba(${edge}, ${0.85 * fade})`);
			gradient.addColorStop(0.5, `rgba(${core}, ${0.95 * fade})`);
			gradient.addColorStop(1, `rgba(${edge}, ${0.85 * fade})`);
			ctx.shadowColor = left
				? "rgba(0, 255, 255, 0.55)"
				: "rgba(255, 120, 255, 0.55)";
			ctx.shadowBlur = 4 + g.energy * 4;
			ctx.beginPath();
			ctx.moveTo(spike.x, g.cy - spike.amp);
			ctx.lineTo(spike.x, g.cy + spike.amp);
			ctx.strokeStyle = gradient;
			ctx.lineWidth = Math.max(1, 1.4 - spike.t * 0.6);
			ctx.stroke();
		}
		ctx.restore();
	}
	const lineWidth = Math.max(2.5, g.orbRadius * 0.17);
	const glow = 7 + g.energy * 9;
	ctx.save();
	orbHues().forEach((hue, index) => {
		ctx.beginPath();
		ctx.arc(
			g.cx,
			g.cy,
			g.orbRadius,
			(index / 72) * Math.PI * 2,
			((index + 1) / 72) * Math.PI * 2,
		);
		ctx.strokeStyle = `hsla(${hue}, 96%, 62%, 0.95)`;
		ctx.lineWidth = lineWidth;
		ctx.shadowColor = `hsla(${hue}, 100%, 68%, 0.85)`;
		ctx.shadowBlur = glow;
		ctx.stroke();
	});
	ctx.shadowBlur = glow * 0.45;
	ctx.lineWidth = Math.max(1, lineWidth * 0.38);
	ctx.globalAlpha = 0.5;
	ctx.beginPath();
	ctx.arc(g.cx, g.cy, g.orbRadius * 0.86, 0, Math.PI * 2);
	ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
	ctx.stroke();
	ctx.restore();
}
