import {
	between,
	blur,
	circle,
	fmt,
	H,
	linear,
	path,
	radial,
	rect,
	rng,
	svg,
	W,
} from "./shapes";

/** Night industrial compound under a helicopter searchlight. */
export function tacticalArt(): string {
	const rand = rng(0x7ac7);
	const defs = [
		linear("sky", [
			[0, "#060a09"],
			[0.55, "#0f1915"],
			[1, "#1d2a24"],
		]),
		linear("beam", [
			[0, "#e9ffe9", 0.55],
			[0.5, "#cfe8d2", 0.16],
			[1, "#cfe8d2", 0.04],
		]),
		radial("pool", [
			[0, "#e8ffe6", 0.42],
			[1, "#e8ffe6", 0],
		]),
		radial("lamp", [
			[0, "#ffb75a", 0.85],
			[1, "#ffb75a", 0],
		]),
		linear("fog", [
			[0, "#33463d", 0],
			[1, "#3d5248", 0.75],
		]),
		blur("soft", 8),
		blur("wide", 22),
	].join("");
	const steel = "#030605";
	const structures = [
		// Storage tanks.
		rect(140, 300, 170, 180, `fill="${steel}"`),
		path("M140,300 Q225,270 310,300Z", `fill="${steel}"`),
		rect(330, 330, 120, 150, `fill="${steel}"`),
		path("M330,330 Q390,310 450,330Z", `fill="${steel}"`),
		// Stacks with ladders and beacon lights.
		rect(560, 150, 34, 330, `fill="${steel}"`),
		rect(612, 210, 26, 270, `fill="${steel}"`),
		circle(577, 146, 4, 'fill="#ff3b30"'),
		circle(625, 206, 3.5, 'fill="#ff3b30"'),
		// Warehouse with a saw-tooth roof.
		path(
			"M700,480 L700,360 L760,330 L760,360 L820,330 L820,360 L880,330 L880,360 L940,330 L940,360 L1000,330 L1000,480Z",
			`fill="${steel}"`,
		),
		// Pipe rack.
		rect(1000, 392, 420, 10, `fill="${steel}"`),
		rect(1000, 412, 420, 8, `fill="${steel}"`),
		...Array.from({ length: 8 }, (_, i) =>
			rect(1010 + i * 56, 392, 6, 88, `fill="${steel}"`),
		),
		// Gantry crane.
		rect(1460, 220, 14, 260, `fill="${steel}"`),
		rect(1640, 220, 14, 260, `fill="${steel}"`),
		rect(1420, 212, 300, 16, `fill="${steel}"`),
		path(
			"M1474,228 L1640,300 M1474,300 L1640,228 M1474,300 L1640,372 M1474,372 L1640,300",
			`stroke="${steel}" stroke-width="5"`,
		),
		// Control tower.
		rect(1760, 260, 90, 220, `fill="${steel}"`),
		rect(1745, 240, 120, 26, `fill="${steel}"`),
		rect(1770, 248, 70, 10, 'fill="#5d7d63" opacity="0.6"'),
	].join("");
	let fence = "";
	for (let x = 0; x < W; x += 22)
		fence += `<line x1="${x}" y1="436" x2="${x}" y2="480"/>`;
	let lamps = "";
	for (const x of [90, 520, 1080, 1380, 1700]) {
		lamps += rect(x - 2, 380, 4, 100, `fill="${steel}"`);
		lamps += circle(x, 380, 30, 'fill="url(#lamp)"');
		lamps += circle(x, 380, 3, 'fill="#ffd9a0"');
	}
	const soldiers = Array.from({ length: 5 }, (_, i) => {
		const x = 1100 + i * 38 + between(rand, -8, 8);
		const y = 452;
		return `${circle(x, y - 34, 5.5, `fill="${steel}"`)}${path(
			`M${fmt(x - 7)},${y} L${fmt(x - 6)},${y - 18} L${fmt(x - 9)},${y - 27} Q${fmt(x)},${y - 32} ${fmt(x + 9)},${y - 27} L${fmt(x + 6)},${y - 18} L${fmt(x + 7)},${y}Z`,
			`fill="${steel}"`,
		)}`;
	}).join("");
	const heli = `<g transform="translate(1180 70)">${path(
		"M-46,0 Q-40,-14 -10,-14 L22,-12 Q34,-10 38,0 Q30,10 -10,10 Q-40,10 -46,0Z M38,-4 L96,-8 L98,0 L40,4Z M92,-18 L100,-18 L102,4 L94,4Z",
		`fill="${steel}"`,
	)}${rect(-70, -22, 150, 3, `fill="${steel}" opacity="0.8"`)}${circle(-30, 8, 4, 'fill="#f4fff2"')}</g>`;
	const body = [
		rect(0, 0, W, H, 'fill="url(#sky)"'),
		`<g filter="url(#wide)" opacity="0.6">${circle(1150, 480, 380, 'fill="#2a3a32"')}</g>`,
		structures,
		// The beam lands on the yard in front of the warehouse.
		path(
			"M1150,78 L940,480 L1290,480Z",
			'fill="url(#beam)" filter="url(#soft)"',
		),
		`<ellipse cx="1115" cy="470" rx="190" ry="26" fill="url(#pool)"/>`,
		soldiers,
		lamps,
		rect(0, 380, W, 100, 'fill="url(#fog)" filter="url(#soft)"'),
		`<g stroke="${steel}" stroke-width="2" opacity="0.9">${fence}<line x1="0" y1="438" x2="${W}" y2="438"/><line x1="0" y1="458" x2="${W}" y2="458"/></g>`,
		heli,
	].join("");
	return svg(defs, body);
}
