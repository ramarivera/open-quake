/** Run from a Vite-served browser: (await import('/src/shared/gif/browser-smoke.ts')).runGifBrowserSmoke().
 * Uses the browser's independent WebCodecs GIF decoder and real canvas/font/image APIs.
 * This module is a manual test entry, never imported by the production codec.
 */
import {
	captionGif,
	stillImageGif,
} from "../../renderer/src/management/emoji/caption";
import {
	disposalFixture,
	fixtureBytes,
	interlaceFixture,
	partialOpaqueFixture,
	pngFixture,
	retainFixture,
	tinyFixture,
} from "./fixtures";
import { decodeGif, encodeGif, type GifAnimation } from "./index";

// ImageDecoder is implemented in Chromium but not yet in TypeScript's DOM lib.
declare class ImageDecoder {
	constructor(options: {
		data: Uint8Array;
		type: string;
		preferAnimation: boolean;
	});
	readonly tracks: { readonly ready: Promise<void> };
	decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
	close(): void;
}

function assert(value: boolean, message: string): asserts value {
	if (!value) throw new Error(message);
}
function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
	return a.length === b.length && a.every((value, i) => value === b[i]);
}
async function nativeCompare(bytes: Uint8Array): Promise<number> {
	const animation = decodeGif(bytes);
	const decoder = new ImageDecoder({
		data: bytes,
		type: "image/gif",
		preferAnimation: true,
	});
	try {
		await decoder.tracks.ready;
		const canvas = document.createElement("canvas");
		canvas.width = animation.width;
		canvas.height = animation.height;
		const context = canvas.getContext("2d");
		assert(context !== null, "2D canvas unavailable");
		for (let i = 0; i < animation.frames.length; i++) {
			const { image } = await decoder.decode({ frameIndex: i });
			try {
				context.clearRect(0, 0, canvas.width, canvas.height);
				context.drawImage(image, 0, 0);
				const native = context.getImageData(
					0,
					0,
					canvas.width,
					canvas.height,
				).data;
				const expected = animation.frames[i];
				assert(
					expected !== undefined && samePixels(native, expected.rgba),
					`Native mismatch at frame ${i}`,
				);
			} finally {
				image.close();
			}
		}
	} finally {
		decoder.close();
	}
	return animation.frames.length;
}

export async function runGifBrowserSmoke() {
	let nativeFrames = 0;
	for (const fixture of [
		disposalFixture,
		retainFixture,
		interlaceFixture,
		tinyFixture,
		partialOpaqueFixture,
	])
		nativeFrames += await nativeCompare(fixtureBytes(fixture));
	const lzw = await fetch(
		new URL("./fixtures/pillow-lzw.gif", import.meta.url),
	);
	assert(lzw.ok, "Independent LZW fixture unavailable");
	nativeFrames += await nativeCompare(new Uint8Array(await lzw.arrayBuffer()));
	const width = 256;
	const height = 128;
	let state = 0xdeadbeef;
	const rgba = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		const v = (state >>> 24) % 255;
		rgba.set(i % 17 === 0 ? [0, 0, 0, 0] : [v, v, 255 - v, 255], i * 4);
	}
	const random: GifAnimation = {
		width,
		height,
		loopCount: 3,
		frames: [
			{ rgba, delayMs: 20 },
			{ rgba: rgba.slice(), delayMs: 70 },
		],
	};
	// Use a valid RGBA second frame with transparency that differs from the first.
	const second = random.frames[1];
	assert(second !== undefined, "Missing frame");
	second.rgba.set(rgba);
	second.rgba.fill(0, 0, 128 * 4);
	nativeFrames += await nativeCompare(encodeGif(random));
	const original: GifAnimation = {
		width,
		height,
		loopCount: 7,
		frames: [
			{
				rgba: new Uint8ClampedArray(
					Array.from({ length: width * height }, () => [180, 0, 0, 255]).flat(),
				),
				delayMs: 20,
			},
			{
				rgba: new Uint8ClampedArray(
					Array.from({ length: width * height }, () => [0, 0, 180, 255]).flat(),
				),
				delayMs: 70,
			},
		],
	};
	const source = encodeGif(original);
	const copy = source.slice();
	await captionGif(source, { text: "Hi" });
	const bye = await captionGif(source, { text: "Bye" });
	const byeAgain = await captionGif(source, {
		text: "Bye",
		size: 48,
		color: "0xffffffff",
		position: "bot",
	});
	assert(
		bye.every((value, i) => value === byeAgain[i]),
		"Caption edits accumulate or defaults differ",
	);
	assert(
		source.every((value, i) => value === copy[i]),
		"Original source was mutated",
	);
	const result = decodeGif(bye);
	assert(
		result.width === width &&
			result.height === height &&
			result.loopCount === 7,
		"Caption canvas/loop metadata changed",
	);
	assert(
		result.frames.map((frame) => frame.delayMs).join(",") === "20,70",
		"Caption delays changed",
	);
	assert(
		result.frames.every((frame, i) => {
			const before = original.frames[i];
			return before !== undefined && !samePixels(frame.rgba, before.rgba);
		}),
		"Caption missing from a frame",
	);
	nativeFrames += await nativeCompare(bye);
	const positions = [];
	for (const position of ["top", "mid", "bot"] satisfies (
		| "top"
		| "mid"
		| "bot"
	)[]) {
		const rendered = decodeGif(
			await captionGif(source, { text: "Hi", size: 24, position }),
		);
		const first = rendered.frames[0];
		assert(first !== undefined, "Missing caption frame");
		const rows = [];
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				const at = (y * width + x) * 4;
				if (
					(first.rgba[at] ?? 0) > 200 &&
					(first.rgba[at + 1] ?? 0) > 200 &&
					(first.rgba[at + 2] ?? 0) > 200
				)
					rows.push(y);
			}
		assert(rows.length > 0, `No white text at ${position}`);
		const middle = (Math.min(...rows) + Math.max(...rows)) / 2;
		assert(
			position === "top"
				? middle < 32
				: position === "mid"
					? middle > 48 && middle < 80
					: middle > 96,
			`Caption ${position} outside its region`,
		);
		positions.push({
			position,
			firstRow: Math.min(...rows),
			lastRow: Math.max(...rows),
		});
	}
	const png = await stillImageGif(`data:image/png;base64,${pngFixture}`);
	const imported = decodeGif(png);
	assert(
		imported.width === 2 &&
			imported.height === 1 &&
			imported.frames.length === 1 &&
			imported.loopCount === null,
		"PNG import metadata changed",
	);
	assert(
		imported.frames[0]?.rgba.every(
			(value, i) => value === [255, 0, 0, 255][i % 4],
		) === true,
		"PNG import colours changed",
	);
	nativeFrames += await nativeCompare(png);
	const canvas = document.createElement("canvas");
	canvas.width = 32;
	canvas.height = 16;
	const context = canvas.getContext("2d");
	assert(context !== null, "JPEG canvas unavailable");
	context.fillStyle = "red";
	context.fillRect(0, 0, 32, 16);
	const jpeg = await stillImageGif(canvas.toDataURL("image/jpeg"));
	const jpegAnimation = decodeGif(jpeg);
	assert(
		jpegAnimation.width === 32 &&
			jpegAnimation.height === 16 &&
			jpegAnimation.frames.length === 1,
		"JPEG import failed",
	);
	nativeFrames += await nativeCompare(jpeg);
	return {
		nativeFrames,
		captionFrames: result.frames.length,
		positions,
		stillImports: ["PNG", "JPEG"],
		originalUnchanged: true,
	};
}
