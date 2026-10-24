interface Colour {
	r: number;
	g: number;
	b: number;
	count: number;
}
interface Box {
	colours: Colour[];
	count: number;
	axis: "r" | "g" | "b";
	score: number;
}

function box(colours: Colour[]): Box {
	let count = 0;
	let minR = 255;
	let minG = 255;
	let minB = 255;
	let maxR = 0;
	let maxG = 0;
	let maxB = 0;
	for (const c of colours) {
		count += c.count;
		minR = Math.min(minR, c.r);
		minG = Math.min(minG, c.g);
		minB = Math.min(minB, c.b);
		maxR = Math.max(maxR, c.r);
		maxG = Math.max(maxG, c.g);
		maxB = Math.max(maxB, c.b);
	}
	const r = maxR - minR;
	const g = maxG - minG;
	const b = maxB - minB;
	const axis = r >= g && r >= b ? "r" : g >= b ? "g" : "b";
	return {
		colours,
		count,
		axis,
		score: colours.length < 2 ? 0 : Math.max(r, g, b) * Math.sqrt(count),
	};
}

function medianCut(colours: Colour[]): Uint8Array {
	const boxes = [box(colours)];
	while (boxes.length < 255) {
		let selected = 0;
		for (let i = 1; i < boxes.length; i++) {
			if ((boxes[i]?.score ?? 0) > (boxes[selected]?.score ?? 0)) selected = i;
		}
		const current = boxes[selected];
		if (current === undefined || current.score === 0) break;
		current.colours.sort((a, b) => a[current.axis] - b[current.axis]);
		let weight = 0;
		let split = 0;
		while (split < current.colours.length - 1 && weight < current.count / 2) {
			weight += current.colours[split++]?.count ?? 0;
		}
		boxes[selected] = box(current.colours.slice(0, split));
		boxes.push(box(current.colours.slice(split)));
	}
	const palette = new Uint8Array(768);
	for (let i = 0; i < boxes.length; i++) {
		const current = boxes[i];
		if (current === undefined) continue;
		let r = 0;
		let g = 0;
		let b = 0;
		for (const c of current.colours) {
			r += c.r * c.count;
			g += c.g * c.count;
			b += c.b * c.count;
		}
		palette[(i + 1) * 3] = Math.round(r / current.count);
		palette[(i + 1) * 3 + 1] = Math.round(g / current.count);
		palette[(i + 1) * 3 + 2] = Math.round(b / current.count);
	}
	return palette;
}

const bin = (r: number, g: number, b: number): number =>
	((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
const rgb = (rgba: Uint8ClampedArray, at: number): number =>
	((rgba[at] ?? 0) << 16) | ((rgba[at + 1] ?? 0) << 8) | (rgba[at + 2] ?? 0);

/** Exact through 255 opaque colours; otherwise weighted median cut over a bounded 5-bit histogram.
 * Index zero is always transparent. GIF has binary alpha, using an alpha >= 128 cutoff.
 */
export function quantize(rgba: Uint8ClampedArray): {
	indices: Uint8Array;
	palette: Uint8Array;
} {
	const exact = new Map<number, number>();
	for (let at = 0; at < rgba.length; at += 4) {
		if ((rgba[at + 3] ?? 0) < 128) continue;
		const colour = rgb(rgba, at);
		if (!exact.has(colour)) exact.set(colour, exact.size + 1);
		if (exact.size > 255) break;
	}
	const indices = new Uint8Array(rgba.length / 4);
	if (exact.size <= 255) {
		const palette = new Uint8Array(768);
		for (const [colour, index] of exact) {
			palette[index * 3] = colour >>> 16;
			palette[index * 3 + 1] = (colour >>> 8) & 255;
			palette[index * 3 + 2] = colour & 255;
		}
		for (let at = 0; at < rgba.length; at += 4) {
			if ((rgba[at + 3] ?? 0) >= 128)
				indices[at / 4] = exact.get(rgb(rgba, at)) ?? 0;
		}
		return { indices, palette };
	}
	const counts = new Uint32Array(32768);
	const red = new Uint32Array(32768);
	const green = new Uint32Array(32768);
	const blue = new Uint32Array(32768);
	for (let at = 0; at < rgba.length; at += 4) {
		if ((rgba[at + 3] ?? 0) < 128) continue;
		const r = rgba[at] ?? 0;
		const g = rgba[at + 1] ?? 0;
		const b = rgba[at + 2] ?? 0;
		const index = bin(r, g, b);
		counts[index] = (counts[index] ?? 0) + 1;
		red[index] = (red[index] ?? 0) + r;
		green[index] = (green[index] ?? 0) + g;
		blue[index] = (blue[index] ?? 0) + b;
	}
	const colours: Colour[] = [];
	for (let i = 0; i < counts.length; i++) {
		const count = counts[i] ?? 0;
		if (count > 0)
			colours.push({
				r: (red[i] ?? 0) / count,
				g: (green[i] ?? 0) / count,
				b: (blue[i] ?? 0) / count,
				count,
			});
	}
	const palette = medianCut(colours);
	const cache = new Uint8Array(32768);
	for (let at = 0; at < rgba.length; at += 4) {
		if ((rgba[at + 3] ?? 0) < 128) continue;
		const bucket = bin(rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0);
		let index = cache[bucket] ?? 0;
		if (index === 0) {
			const count = counts[bucket] ?? 1;
			const r = (red[bucket] ?? 0) / count;
			const g = (green[bucket] ?? 0) / count;
			const b = (blue[bucket] ?? 0) / count;
			let best = Number.POSITIVE_INFINITY;
			for (
				let candidate = 1;
				candidate <= Math.min(255, colours.length);
				candidate++
			) {
				const distance =
					(r - (palette[candidate * 3] ?? 0)) ** 2 +
					(g - (palette[candidate * 3 + 1] ?? 0)) ** 2 +
					(b - (palette[candidate * 3 + 2] ?? 0)) ** 2;
				if (distance < best) {
					best = distance;
					index = candidate;
				}
			}
			cache[bucket] = index;
		}
		indices[at / 4] = index;
	}
	return { indices, palette };
}
