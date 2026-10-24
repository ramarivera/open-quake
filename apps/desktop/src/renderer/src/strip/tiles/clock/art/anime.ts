import {
	between,
	blur,
	circle,
	H,
	linear,
	path,
	radial,
	rect,
	rng,
	smoothPath,
	svg,
	W,
} from "./shapes";

/** Bright summer sky with towering cumulus over green hills. */
export function animeArt(): string {
	const rand = rng(0xa71e);
	const defs = [
		linear("sky", [
			[0, "#1f6fd6"],
			[0.4, "#4fa3f0"],
			[0.75, "#9fd6ff"],
			[1, "#e4f6ff"],
		]),
		radial(
			"sun",
			[
				[0, "#ffffff", 0.95],
				[0.2, "#fff8dc", 0.5],
				[1, "#fff8dc", 0],
			],
			'cx="0.12" cy="0.05" r="0.35" gradientTransform="translate(0.12 0.05) scale(1 3) translate(-0.12 -0.05)"',
		),
		linear("cloud", [
			[0, "#ffffff"],
			[0.6, "#f4f8ff"],
			[1, "#c9d9ee"],
		]),
		linear("hillFar", [
			[0, "#8fcf7a"],
			[1, "#6fb862"],
		]),
		linear("hillMid", [
			[0, "#5fb84a"],
			[1, "#3f9a3c"],
		]),
		linear("hillNear", [
			[0, "#3f9f3a"],
			[1, "#2a7a2e"],
		]),
		blur("puff", 2.2),
		blur("far", 3),
	].join("");
	// A cumulus is many overlapping puffs over a flat base, shaded as one mass.
	let clouds = 0;
	const cumulus = (
		cx: number,
		baseY: number,
		width: number,
		height: number,
		puffs: number,
	): string => {
		const id = `cumulus${clouds++}`;
		const fill = `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${baseY - height}" x2="0" y2="${baseY}"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f3f7fd"/><stop offset="1" stop-color="#c3d3e9"/></linearGradient>`;
		let body = "";
		let rim = "";
		for (let i = 0; i < puffs; i++) {
			const t = rand() ** 0.8;
			const spread = width * (0.5 - t * 0.3);
			const x = cx + (rand() - 0.5) * 2 * spread;
			const r = width * between(rand, 0.045, 0.1) * (1.15 - t * 0.5);
			const y = Math.min(baseY - r * 0.6, baseY - t * height + r * 0.3);
			body += circle(x, y, r, `fill="url(#${id})"`);
			if (t > 0.35)
				rim += circle(
					x - r * 0.18,
					y - r * 0.2,
					r * 0.7,
					'fill="#ffffff" opacity="0.55"',
				);
		}
		return `<defs>${fill}</defs><g filter="url(#puff)">${body}${rim}</g>`;
	};
	const hill = (keys: readonly (readonly [number, number])[]): string =>
		smoothPath(keys);
	const trees = (count: number, from: number, to: number, y: number): string =>
		Array.from({ length: count }, () => {
			const x = between(rand, from, to);
			const r = between(rand, 10, 20);
			const yy = y + between(rand, -8, 8);
			return `${circle(x, yy, r, 'fill="#2f7f33"')}${circle(x - r * 0.3, yy - r * 0.3, r * 0.55, 'fill="#4ea445"')}`;
		}).join("");
	const body = [
		rect(0, 0, W, H, 'fill="url(#sky)"'),
		rect(0, 0, W, H, 'fill="url(#sun)"'),
		`<g opacity="0.7" filter="url(#far)">${cumulus(1700, 336, 340, 110, 60)}${cumulus(420, 330, 300, 90, 50)}</g>`,
		cumulus(1150, 370, 640, 310, 190),
		cumulus(1520, 380, 380, 160, 110),
		cumulus(720, 380, 320, 120, 90),
		path(
			hill([
				[0, 360],
				[300, 340],
				[620, 368],
				[980, 350],
				[1320, 372],
				[1640, 344],
				[1920, 358],
			]),
			'fill="url(#hillFar)"',
		),
		trees(26, 40, 1880, 368),
		path(
			hill([
				[0, 410],
				[260, 388],
				[560, 404],
				[900, 384],
				[1240, 410],
				[1600, 392],
				[1920, 404],
			]),
			'fill="url(#hillMid)"',
		),
		path(
			hill([
				[0, 458],
				[340, 440],
				[760, 456],
				[1180, 446],
				[1560, 462],
				[1920, 448],
			]),
			'fill="url(#hillNear)"',
		),
		// A pale path winding over the near hill.
		path(
			"M1040,480 C1060,462 1090,452 1130,446 C1170,440 1200,436 1236,428",
			'fill="none" stroke="#e8e2b8" stroke-width="6" stroke-linecap="round" opacity="0.8"',
		),
	].join("");
	void H;
	return svg(defs, body);
}
