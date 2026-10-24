import {
	between,
	blur,
	circle,
	fmt,
	H,
	linear,
	path,
	rect,
	ridgePath,
	ridgePoints,
	rng,
	svg,
	W,
} from "./shapes";

/** Green and violet aurora curtains over dark mountains. */
export function auroraArt(): string {
	const rand = rng(0xa0a0);
	const defs = [
		linear("sky", [
			[0, "#040713"],
			[0.5, "#081530"],
			[1, "#10284a"],
		]),
		linear("curtain", [
			[0, "#b07bff", 0],
			[0.3, "#9b6bff", 0.55],
			[0.62, "#3dffb0", 0.8],
			[1, "#3dffb0", 0],
		]),
		linear("curtain2", [
			[0, "#ff7bd8", 0],
			[0.4, "#b48cff", 0.45],
			[0.75, "#5cffc8", 0.6],
			[1, "#5cffc8", 0],
		]),
		linear("far", [
			[0, "#0f1a30"],
			[1, "#080f1f"],
		]),
		linear("near", [
			[0, "#070c18"],
			[1, "#03060d"],
		]),
		linear("snow", [
			[0, "#9fd8ff", 0.35],
			[1, "#9fd8ff", 0],
		]),
		blur("glow", 16),
		blur("rays", 5),
	].join("");
	let stars = "";
	for (let i = 0; i < 260; i++)
		stars += circle(
			between(rand, 0, W),
			between(rand, 0, 300),
			between(rand, 0.5, 1.6),
			`fill="#ffffff" opacity="${between(rand, 0.25, 0.9).toFixed(2)}"`,
		);
	// A curtain is a wavy ribbon; vertical rays give it the folded look.
	const curtain = (
		y: number,
		amp: number,
		depth: number,
		phase: number,
		fill: string,
	): string => {
		const top: string[] = [];
		const bottom: string[] = [];
		const rays: string[] = [];
		for (let x = -40; x <= W + 40; x += 24) {
			const wave =
				Math.sin(x / 260 + phase) * amp +
				Math.sin(x / 97 + phase * 2) * amp * 0.3;
			top.push(`${fmt(x)},${fmt(y + wave - depth)}`);
			bottom.unshift(`${fmt(x)},${fmt(y + wave)}`);
			if (rand() < 0.55)
				rays.push(
					rect(
						x,
						y + wave - depth * between(rand, 0.6, 1.1),
						between(rand, 3, 10),
						depth * between(rand, 0.6, 1),
						`fill="#c8ffe8" opacity="${between(rand, 0.08, 0.28).toFixed(2)}"`,
					),
				);
		}
		return `<path d="M${top.join(" L")} L${bottom.join(" L")}Z" fill="url(#${fill})" filter="url(#glow)"/><g filter="url(#rays)">${rays.join("")}</g>`;
	};
	const far = ridgePoints(
		rand,
		[
			[0, 330],
			[260, 290],
			[520, 330],
			[800, 280],
			[1100, 320],
			[1400, 270],
			[1700, 318],
			[1920, 290],
		],
		0.16,
	);
	const near = ridgePoints(
		rand,
		[
			[0, 380],
			[320, 360],
			[640, 404],
			[980, 372],
			[1300, 410],
			[1640, 368],
			[1920, 392],
		],
		0.14,
	);
	const body = [
		rect(0, 0, W, H, 'fill="url(#sky)"'),
		stars,
		curtain(250, 46, 170, 0.4, "curtain"),
		`<g opacity="0.75">${curtain(205, 34, 130, 2.1, "curtain2")}</g>`,
		`<g opacity="0.5">${curtain(300, 26, 110, 4.2, "curtain")}</g>`,
		path(ridgePath(far), 'fill="url(#far)"'),
		path(ridgePath(far), 'fill="url(#snow)" opacity="0.3"'),
		path(ridgePath(near), 'fill="url(#near)"'),
		rect(0, 440, W, 40, 'fill="#03060d"'),
	].join("");
	void H;
	return svg(defs, body);
}
