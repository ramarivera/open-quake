/**
 * Deterministic drawing helpers for the built-in clock art. Every scene is
 * seeded, so the same markup comes out on every machine and every run.
 */

export const W = 1920;
export const H = 480;

export type Rand = () => number;

/** mulberry32: tiny, fast and good enough for scenery. */
export function rng(seed: number): Rand {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export const between = (rand: Rand, min: number, max: number): number =>
	min + (max - min) * rand();

const n = (value: number): string => String(Math.round(value * 10) / 10);

export type Point = readonly [number, number];

/**
 * Midpoint displacement between composition keypoints, so each ridge keeps
 * its designed silhouette and gains natural roughness.
 */
export function ridgePoints(
	rand: Rand,
	keys: readonly Point[],
	roughness: number,
	depth = 6,
): Point[] {
	let points: Point[] = [...keys];
	for (let level = 0; level < depth; level++) {
		const next: Point[] = [];
		for (let i = 0; i < points.length - 1; i++) {
			const a = points[i];
			const b = points[i + 1];
			if (!a || !b) continue;
			const span = b[0] - a[0];
			next.push(a, [
				(a[0] + b[0]) / 2,
				(a[1] + b[1]) / 2 + (rand() - 0.5) * span * roughness,
			]);
		}
		const last = points[points.length - 1];
		if (last) next.push(last);
		points = next;
	}
	return points;
}

/** A filled silhouette from a ridge line down to the bottom edge. */
export function ridgePath(points: readonly Point[], bottom = H): string {
	const first = points[0];
	const last = points[points.length - 1];
	if (!first || !last) return "";
	return `M${n(first[0])},${n(bottom)} ${points
		.map(([x, y]) => `L${n(x)},${n(y)}`)
		.join(" ")} L${n(last[0])},${n(bottom)}Z`;
}

/** Smooth rolling hill through keypoints (Catmull-Rom as cubic Béziers). */
export function smoothPath(points: readonly Point[], bottom = H): string {
	const first = points[0];
	const last = points[points.length - 1];
	if (!first || !last) return "";
	let d = `M${n(first[0])},${n(bottom)} L${n(first[0])},${n(first[1])}`;
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[i - 1] ?? points[i];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = points[i + 2] ?? p2;
		if (!p0 || !p1 || !p2 || !p3) continue;
		const c1: Point = [
			p1[0] + (p2[0] - p0[0]) / 6,
			p1[1] + (p2[1] - p0[1]) / 6,
		];
		const c2: Point = [
			p2[0] - (p3[0] - p1[0]) / 6,
			p2[1] - (p3[1] - p1[1]) / 6,
		];
		d += ` C${n(c1[0])},${n(c1[1])} ${n(c2[0])},${n(c2[1])} ${n(p2[0])},${n(p2[1])}`;
	}
	return `${d} L${n(last[0])},${n(bottom)}Z`;
}

/**
 * A conifer: irregular drooping branch tiers around a spine, broad at the
 * base and narrowing to a thin spire. Left and right sides vary independently.
 */
export function firPath(
	rand: Rand,
	x: number,
	base: number,
	height: number,
	width: number,
): string {
	const tiers = Math.max(6, Math.round(height / 13));
	const tierH = (height * 0.92) / tiers;
	const side = (dir: 1 | -1): Point[] => {
		const out: Point[] = [[x + dir * width * 0.05, base]];
		for (let i = 0; i < tiers; i++) {
			const t = i / tiers;
			const y = base - height * 0.05 - i * tierH;
			const reach = (width / 2) * (1 - t) ** 0.95 * between(rand, 0.65, 1.15);
			const droop = tierH * between(rand, 0.15, 0.55);
			out.push(
				[x + dir * reach, y + droop],
				[x + dir * reach * between(rand, 0.55, 0.8), y - tierH * 0.2],
				[
					x + dir * Math.max(2, reach * between(rand, 0.12, 0.3)),
					y - tierH * between(rand, 0.55, 0.85),
				],
			);
		}
		return out;
	};
	const apex: Point = [x + between(rand, -1, 1), base - height];
	const outline = [...side(-1), apex, ...side(1).reverse()];
	return `M${outline.map(([px, py]) => `${n(px)},${n(py)}`).join(" L")}Z`;
}

export const rect = (
	x: number,
	y: number,
	width: number,
	height: number,
	attrs = "",
): string =>
	`<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}"${attrs ? ` ${attrs}` : ""}/>`;

export const circle = (cx: number, cy: number, r: number, attrs = ""): string =>
	`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"${attrs ? ` ${attrs}` : ""}/>`;

export const path = (d: string, attrs = ""): string =>
	`<path d="${d}"${attrs ? ` ${attrs}` : ""}/>`;

export const fmt = n;

export function linear(
	id: string,
	stops: readonly (readonly [number, string, number?])[],
	vertical = true,
): string {
	const dir = vertical
		? 'x1="0" y1="0" x2="0" y2="1"'
		: 'x1="0" y1="0" x2="1" y2="0"';
	return `<linearGradient id="${id}" ${dir}>${stops
		.map(
			([offset, color, opacity = 1]) =>
				`<stop offset="${offset}" stop-color="${color}" stop-opacity="${opacity}"/>`,
		)
		.join("")}</linearGradient>`;
}

export function radial(
	id: string,
	stops: readonly (readonly [number, string, number?])[],
	attrs = "",
): string {
	return `<radialGradient id="${id}"${attrs ? ` ${attrs}` : ""}>${stops
		.map(
			([offset, color, opacity = 1]) =>
				`<stop offset="${offset}" stop-color="${color}" stop-opacity="${opacity}"/>`,
		)
		.join("")}</radialGradient>`;
}

export const blur = (id: string, std: number): string =>
	`<filter id="${id}" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${std}"/></filter>`;

export function svg(defs: string, body: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`;
}
