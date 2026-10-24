import {
	between,
	blur,
	fmt,
	H,
	linear,
	radial,
	rect,
	rng,
	svg,
	W,
} from "./shapes";

const NEON = ["#ff2bd6", "#20e6ff", "#8a5bff", "#ff4f8b", "#3d7bff"] as const;
const WINDOW = ["#7fe9ff", "#ff9ef0", "#ffd38a", "#b9a6ff"] as const;

/** Rainy neon megacity at night, violet and blue. */
export function cyberArt(): string {
	const rand = rng(0xc7be);
	const pick = <T>(list: readonly T[]): T =>
		list[Math.floor(rand() * list.length)] ?? (list[0] as T);
	const defs = [
		linear("sky", [
			[0, "#07041a"],
			[0.45, "#1b0c45"],
			[0.78, "#4a1670"],
			[1, "#7a2a8a"],
		]),
		radial(
			"glow",
			[
				[0, "#ff4fd8", 0.55],
				[1, "#ff4fd8", 0],
			],
			'cx="0.55" cy="1" r="0.6" gradientTransform="translate(0.55 1) scale(1 1.8) translate(-0.55 -1)"',
		),
		linear("haze", [
			[0, "#6b2aa8", 0],
			[1, "#9b3cc4", 0.55],
		]),
		linear("street", [
			[0, "#1a0b33", 0.2],
			[1, "#05030d", 0.95],
		]),
		blur("neon", 6),
		blur("bloom", 18),
		blur("fog", 10),
	].join("");
	// Three depth layers: hazy far towers, mid blocks, near silhouettes.
	const layer = (
		count: number,
		minH: number,
		maxH: number,
		minW: number,
		maxW: number,
		fill: string,
		windows: number,
		signs: number,
	): string => {
		let out = "";
		let x = -40;
		const glow: string[] = [];
		while (x < W) {
			const w = between(rand, minW, maxW);
			const h = between(rand, minH, maxH);
			const top = H - h;
			out += rect(x, top, w, h, `fill="${fill}"`);
			if (rand() < 0.35)
				out += rect(
					x + w * 0.4,
					top - h * 0.18,
					w * 0.2,
					h * 0.18,
					`fill="${fill}"`,
				);
			for (let i = 0; i < windows * (w / 60); i++) {
				const wx = x + between(rand, 4, w - 8);
				const wy = top + between(rand, 6, h - 10);
				out += rect(
					wx,
					wy,
					between(rand, 2, 5),
					between(rand, 2, 4),
					`fill="${pick(WINDOW)}" opacity="${between(rand, 0.35, 0.95).toFixed(2)}"`,
				);
			}
			if (rand() < signs) {
				const color = pick(NEON);
				const sx = x + between(rand, 4, w - 14);
				const sy = top + between(rand, 10, Math.max(12, h * 0.5));
				const vertical = rand() < 0.6;
				const sw = vertical ? between(rand, 6, 10) : between(rand, 30, 70);
				const sh = vertical ? between(rand, 40, 110) : between(rand, 8, 14);
				glow.push(rect(sx, sy, sw, sh, `fill="${color}"`));
				out += rect(sx, sy, sw, sh, `fill="${color}" opacity="0.95"`);
			}
			x += w + between(rand, -6, 4);
		}
		void count;
		return `${out}<g filter="url(#bloom)" opacity="0.9">${glow.join("")}</g>`;
	};
	let rain = "";
	for (let i = 0; i < 520; i++) {
		const x = between(rand, -100, W);
		const y = between(rand, -40, H);
		const len = between(rand, 14, 40);
		rain += `<line x1="${fmt(x)}" y1="${fmt(y)}" x2="${fmt(x + len * 0.22)}" y2="${fmt(y + len)}"/>`;
	}
	let reflections = "";
	for (let i = 0; i < 70; i++) {
		const x = between(rand, 0, W);
		reflections += rect(
			x,
			between(rand, 430, 470),
			between(rand, 3, 9),
			between(rand, 12, 40),
			`fill="${pick(NEON)}" opacity="${between(rand, 0.2, 0.55).toFixed(2)}"`,
		);
	}
	const body = [
		rect(0, 0, W, H, 'fill="url(#sky)"'),
		rect(0, 0, W, H, 'fill="url(#glow)"'),
		`<g opacity="0.55">${layer(0, 180, 380, 40, 110, "#2a1658", 2, 0.12)}</g>`,
		rect(0, 200, W, 280, 'fill="url(#haze)" filter="url(#fog)"'),
		`<g opacity="0.9">${layer(0, 120, 300, 60, 150, "#140a33", 4, 0.35)}</g>`,
		rect(0, 330, W, 150, 'fill="url(#haze)" opacity="0.5" filter="url(#fog)"'),
		layer(0, 60, 200, 80, 190, "#07041a", 3, 0.5),
		rect(0, 420, W, 60, 'fill="url(#street)"'),
		`<g filter="url(#neon)">${reflections}</g>`,
		`<g stroke="#b9d4ff" stroke-width="1.2" stroke-linecap="round" opacity="0.28">${rain}</g>`,
	].join("");
	return svg(defs, body);
}
