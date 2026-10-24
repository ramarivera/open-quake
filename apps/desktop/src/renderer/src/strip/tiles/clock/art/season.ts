import {
	between,
	blur,
	circle,
	firPath,
	H,
	linear,
	path,
	radial,
	rect,
	ridgePath,
	ridgePoints,
	rng,
	svg,
	W,
} from "./shapes";

/** Misty alpine valley at sunrise: blue-grey firs under a peach sky. */
export function seasonArt(): string {
	const rand = rng(0x5ea5);
	const defs = [
		linear("sky", [
			[0, "#8d9db3"],
			[0.32, "#c9b4b0"],
			[0.6, "#efc6a6"],
			[0.82, "#f6d8bb"],
			[1, "#e8d6c8"],
		]),
		radial(
			"sun",
			[
				[0, "#fff1d6", 0.95],
				[0.25, "#ffd9b0", 0.55],
				[1, "#ffd0a8", 0],
			],
			'cx="0.66" cy="0.58" r="0.42" gradientTransform="translate(0.66 0.58) scale(1 2.6) translate(-0.66 -0.58)"',
		),
		linear("far", [
			[0, "#aab6c8"],
			[1, "#c4cad6"],
		]),
		linear("mid", [
			[0, "#7f90a8"],
			[1, "#a6b2c4"],
		]),
		linear("peak", [
			[0, "#6d7f97"],
			[0.5, "#7a8ba2"],
			[1, "#93a1b5"],
		]),
		linear("near", [
			[0, "#566a83"],
			[1, "#7d8fa6"],
		]),
		linear("mist", [
			[0, "#eef1f6", 0],
			[0.45, "#eef1f6", 0.7],
			[1, "#f4f6fa", 0.92],
		]),
		linear("floor", [
			[0, "#b8c3d2", 0],
			[1, "#d9e0ea", 0.95],
		]),
		linear(
			"peakLight",
			[
				[0, "#d8c0bb", 0],
				[0.35, "#d8c0bb", 0],
				[0.62, "#e6c9bb", 0.42],
				[1, "#e6c9bb", 0.1],
			],
			false,
		),
		blur("soft", 14),
		blur("leaf", 1.2),
		blur("haze", 4),
	].join("");
	const far = ridgePoints(
		rand,
		[
			[760, 300],
			[900, 262],
			[1040, 284],
			[1200, 246],
			[1360, 276],
			[1520, 250],
			[1700, 272],
			[1920, 240],
		],
		0.12,
	);
	const mid = ridgePoints(
		rand,
		[
			[800, 340],
			[980, 300],
			[1120, 330],
			[1300, 312],
			[1460, 344],
			[1640, 300],
			[1800, 262],
			[1920, 250],
		],
		0.14,
	);
	// The big flank: rises from the valley to the top-left corner.
	const peak = ridgePoints(
		rand,
		[
			[0, 40],
			[220, -10],
			[430, 6],
			[560, 70],
			[700, 150],
			[860, 250],
			[1020, 340],
			[1180, 410],
		],
		0.09,
	);
	const near = ridgePoints(
		rand,
		[
			[1280, 420],
			[1480, 360],
			[1680, 300],
			[1920, 262],
		],
		0.1,
	);
	const firs = (
		from: number,
		to: number,
		base: number,
		minH: number,
		maxH: number,
		count: number,
		fill: string,
	): string => {
		let out = "";
		for (let i = 0; i < count; i++) {
			const x = between(rand, from, to);
			const h = between(rand, minH, maxH);
			out += path(
				firPath(rand, x, base + between(rand, -10, 14), h, h * 0.32),
				`fill="${fill}"`,
			);
		}
		return out;
	};
	const body = [
		rect(0, 0, W, H, 'fill="url(#sky)"'),
		rect(0, 0, W, H, 'fill="url(#sun)"'),
		path(ridgePath(far), 'fill="url(#far)" opacity="0.85" filter="url(#haze)"'),
		rect(
			0,
			250,
			W,
			120,
			'fill="url(#mist)" opacity="0.55" filter="url(#soft)"',
		),
		path(ridgePath(mid), 'fill="url(#mid)" opacity="0.9"'),
		rect(0, 300, W, 110, 'fill="url(#mist)" opacity="0.6" filter="url(#soft)"'),
		path(ridgePath(peak), 'fill="url(#peak)"'),
		path(ridgePath(peak), 'fill="url(#peakLight)"'),
		`<polyline points="${peak
			.filter(([x]) => x > 380)
			.map(([x, y]) => `${x.toFixed(1)},${(y + 1).toFixed(1)}`)
			.join(
				" ",
			)}" fill="none" stroke="#f7dcc6" stroke-opacity="0.55" stroke-width="2.5"/>`,
		path(ridgePath(near), 'fill="url(#near)" opacity="0.92"'),
		// Distant firs along the valley floor, softened by mist.
		`<g opacity="0.42">${firs(640, 1480, 450, 34, 70, 34, "#4d5f75")}</g>`,
		rect(0, 360, W, 120, 'fill="url(#floor)" filter="url(#soft)"'),
		`<g opacity="0.82">${firs(1380, 1920, 470, 90, 190, 26, "#33465b")}</g>`,
		firs(0, 560, 500, 220, 470, 16, "#273a4e"),
		firs(1560, 1920, 500, 140, 230, 9, "#25374a"),
		// A frosted broadleaf in the left foreground, as in DK's season art.
		path(
			"M182,480 C184,430 178,380 186,330 M186,372 C200,350 214,338 232,330 M183,396 C168,378 150,368 132,362",
			'fill="none" stroke="#3a3f52" stroke-width="5" stroke-linecap="round"',
		),
		`<g filter="url(#leaf)">${Array.from({ length: 260 }, () => {
			const a = rand() * Math.PI * 2;
			const r = Math.sqrt(rand());
			return circle(
				184 + Math.cos(a) * r * 92,
				338 + Math.sin(a) * r * 74,
				between(rand, 3, 7.5),
				`fill="${rand() > 0.35 ? "#f2dbe3" : "#d9b7c6"}" opacity="${between(rand, 0.45, 0.95).toFixed(2)}"`,
			);
		}).join("")}</g>`,
		rect(0, 420, W, 60, 'fill="#f1f3f7" opacity="0.5" filter="url(#soft)"'),
	].join("");
	return svg(defs, body);
}
