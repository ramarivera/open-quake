import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Writer } from "./bytes";
import {
	disposalFixture,
	fixtureBytes,
	interlaceFixture,
	partialOpaqueFixture,
	retainFixture,
	tinyFixture,
} from "./fixtures";
import {
	decodeGif,
	encodeGif,
	GIF_LIMITS,
	type GifAnimation,
	GifError,
} from "./index";
import { decodeLzw, encodeLzw } from "./lzw";

const palette = [
	[0, 0, 0, 255],
	[255, 0, 0, 255],
	[0, 255, 0, 255],
	[0, 0, 255, 255],
	[0, 0, 0, 0],
];
const pixels = (values: readonly number[]): Uint8ClampedArray =>
	new Uint8ClampedArray(values.flatMap((value) => palette[value] ?? []));
function randomBytes(length: number, seed = 0xdeadbeef): Uint8Array {
	let state = seed;
	return Uint8Array.from({ length }, () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state >>> 24;
	});
}
function repeatedTiny(frames: number, width = 1, height = 1): Uint8Array {
	const tiny = fixtureBytes(tinyFixture);
	const result = new Uint8Array(19 + 15 * frames + 1);
	result.set(tiny.subarray(0, 19));
	result[6] = width & 255;
	result[7] = width >>> 8;
	result[8] = height & 255;
	result[9] = height >>> 8;
	for (let i = 0; i < frames; i++)
		result.set(tiny.subarray(19, 34), 19 + i * 15);
	result[result.length - 1] = 0x3b;
	return result;
}
const still = (
	rgba = pixels([1]),
	loopCount: number | null = null,
): GifAnimation => ({
	width: 1,
	height: 1,
	loopCount,
	frames: [{ rgba, delayMs: 0 }],
});

describe("GIF decoder independent fixtures", () => {
	it("decodes GIF87a and all four interlace passes into canvas row order", () => {
		const result = decodeGif(fixtureBytes(interlaceFixture));
		expect([result.width, result.height, result.loopCount]).toEqual([
			16,
			16,
			null,
		]);
		const expected = Array.from(
			{ length: 256 },
			(_, i) => (Math.floor((i % 16) / 4) + Math.floor(i / 16)) % 4,
		);
		expect(result.frames[0]?.rgba).toEqual(pixels(expected));
	});
	it("composes transparent local palettes and offset rectangles with retained disposal", () => {
		const result = decodeGif(fixtureBytes(retainFixture));
		expect(result.frames.map((frame) => frame.delayMs)).toEqual([
			0, 20, 70, 655350,
		]);
		expect(result.loopCount).toBe(7);
		expect(result.frames.map((frame) => frame.rgba)).toEqual([
			pixels([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
			pixels([1, 2, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1]),
			pixels([1, 2, 3, 1, 1, 2, 3, 1, 1, 1, 1, 1]),
			pixels([1, 2, 3, 2, 1, 2, 3, 2, 1, 1, 1, 1]),
		]);
	});
	it("applies background disposal and restore-previous without aliasing frames", () => {
		const result = decodeGif(fixtureBytes(disposalFixture));
		expect(result.frames.map((frame) => frame.rgba)).toEqual([
			pixels([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
			pixels([1, 2, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1]),
			pixels([4, 4, 3, 4, 4, 4, 3, 4, 4, 4, 4, 4]),
			pixels([4, 4, 4, 2, 4, 4, 4, 2, 4, 4, 4, 4]),
		]);
		result.frames[0]?.rgba.fill(0);
		expect(result.frames[1]?.rgba[3]).toBe(255);
	});
	it("decodes Pillow LZW through 9/10/11/12-bit transitions and dictionary resets", () => {
		const bytes = readFileSync(
			new URL("./fixtures/pillow-lzw.gif", import.meta.url),
		);
		const result = decodeGif(bytes);
		const values = randomBytes(256 * 128);
		const expected = new Uint8ClampedArray(values.length * 4);
		for (let i = 0; i < values.length; i++) {
			const value = values[i] ?? 0;
			expected.set([value, value, 255 - value, 255], i * 4);
		}
		expect(result.frames[0]?.rgba).toEqual(expected);
	});
	it("accepts a minimal GIF and preserves absent GCE/loop metadata", () => {
		expect(decodeGif(fixtureBytes(tinyFixture))).toEqual(still(pixels([0])));
	});
	it("clears uncovered pixels and opaque disposal-2 rectangles like Chromium", () => {
		const decoded = decodeGif(fixtureBytes(partialOpaqueFixture));
		expect(decoded.frames.map((frame) => frame.rgba)).toEqual([
			pixels([0, 4]),
			pixels([4, 0]),
		]);
	});
	it("keeps graphic control through comments and resets it after its image", () => {
		const tiny = repeatedTiny(2);
		const bytes = new Uint8Array([
			...tiny.subarray(0, 19),
			0x21,
			0xf9,
			4,
			0,
			7,
			0,
			0,
			0,
			0x21,
			0xfe,
			2,
			72,
			105,
			0,
			...tiny.subarray(19),
		]);
		expect(decodeGif(bytes).frames.map((frame) => frame.delayMs)).toEqual([
			70, 0,
		]);
		const alternate = fixtureBytes(retainFixture);
		alternate.set(new TextEncoder().encode("ANIMEXTS1.0"), 28);
		expect(decodeGif(alternate).loopCount).toBe(7);
	});
});

describe("GIF encode and quantization", () => {
	it("preserves complete transparent frames, timing, dimensions, finite/infinite/missing loops", () => {
		for (const loopCount of [null, 0, 1, 65535]) {
			const animation: GifAnimation = {
				width: 2,
				height: 1,
				loopCount,
				frames: [
					{ rgba: pixels([1, 2]), delayMs: 10 },
					{ rgba: pixels([4, 3]), delayMs: 0 },
					{ rgba: pixels([4, 4]), delayMs: 655350 },
				],
			};
			expect(decodeGif(encodeGif(animation))).toEqual(animation);
		}
	});
	it("roundtrips all exact opaque colours and the transparency threshold deterministically", () => {
		const rgba = new Uint8ClampedArray(256 * 4);
		for (let i = 0; i < 256; i++)
			rgba.set([i, 255 - i, i, i === 0 ? 127 : 128], i * 4);
		const animation: GifAnimation = {
			width: 256,
			height: 1,
			loopCount: null,
			frames: [{ rgba, delayMs: 0 }],
		};
		const encoded = encodeGif(animation);
		expect(encodeGif(animation)).toEqual(encoded);
		const expected = rgba.slice();
		expected.fill(0, 0, 4);
		for (let i = 1; i < 256; i++) expected[i * 4 + 3] = 255;
		expect(decodeGif(encoded).frames[0]?.rgba).toEqual(expected);
		expect(animation.frames[0]?.rgba).toEqual(rgba);
	});
	it("quantizes a high-colour gradient with bounded error and opaque pixels", () => {
		const rgba = new Uint8ClampedArray(64 * 64 * 4);
		for (let y = 0; y < 64; y++)
			for (let x = 0; x < 64; x++)
				rgba.set([x * 4, y * 4, (x + y) * 2, 255], (y * 64 + x) * 4);
		const result = decodeGif(
			encodeGif({
				width: 64,
				height: 64,
				frames: [{ rgba, delayMs: 100 }],
				loopCount: 0,
			}),
		);
		const rendered = result.frames[0]?.rgba;
		expect(rendered).toBeDefined();
		if (rendered === undefined) return;
		let squaredError = 0;
		for (let i = 0; i < rgba.length; i++) {
			if (i % 4 === 3) expect(rendered[i]).toBe(255);
			else squaredError += ((rendered[i] ?? 0) - (rgba[i] ?? 0)) ** 2;
		}
		expect(Math.sqrt(squaredError / (64 * 64 * 3))).toBeLessThan(12);
	});
	it("roundtrips randomized small animations across sizes, transparency, delays and loop counts", () => {
		for (let seed = 1; seed <= 100; seed++) {
			const width = (seed % 31) + 1;
			const height = (seed % 17) + 1;
			const animation: GifAnimation = {
				width,
				height,
				loopCount: seed % 3 === 0 ? null : seed - 1,
				frames: Array.from({ length: (seed % 5) + 1 }, (_, frame) => ({
					rgba: pixels(
						Array.from(
							randomBytes(width * height, seed + frame),
							(value) => value % 5,
						),
					),
					delayMs: ((seed * frame * 13) % 65536) * 10,
				})),
			};
			expect(decodeGif(encodeGif(animation)), `seed ${seed}`).toEqual(
				animation,
			);
		}
	});
	it("roundtrips LZW at every 9-bit boundary and repeated dictionary saturation", () => {
		for (const count of [1, 253, 254, 255, 256, 257, 1024, 100000]) {
			const values = randomBytes(count);
			const writer = new Writer();
			encodeLzw(values, writer);
			const bytes = writer.finish();
			expect(decodeLzw(bytes, 1, 8, values.length)).toEqual(values);
		}
	});
});

describe("GIF corruption and resource bounds", () => {
	it("rejects every truncation of a known valid file with a stable code", () => {
		const bytes = fixtureBytes(retainFixture);
		for (let length = 0; length < bytes.length; length++)
			expect(() => decodeGif(bytes.subarray(0, length))).toThrow(
				expect.objectContaining({ code: "QUAKE.GIF.INVALID" }),
			);
	});
	it("rejects signature, invalid palette indices, dimensions, offsets, LZW and trailing bytes", () => {
		const tiny = fixtureBytes(tinyFixture);
		for (const [at, value] of [
			[0, 0],
			[6, 0],
			[23, 2],
			[25, 2],
			[29, 1],
			[31, 0],
			[31, 0xff],
			[32, 0],
		]) {
			const corrupt = tiny.slice();
			corrupt[at ?? 0] = value ?? 0;
			expect(() => decodeGif(corrupt), `byte ${at} = ${value}`).toThrow(
				GifError,
			);
		}
		expect(() => decodeGif(new Uint8Array([...tiny, 0]))).toThrow(GifError);
	});
	it("rejects too few/many LZW pixels and bad dictionary references", () => {
		for (const packed of [0x2c, 0x3c, 0x04]) {
			const tiny = fixtureBytes(tinyFixture);
			tiny[31] = packed;
			expect(() => decodeGif(tiny)).toThrow(GifError);
		}
	});
	it("enforces byte and logical-canvas limits before decoding", () => {
		expect(() => decodeGif(new Uint8Array(GIF_LIMITS.maxBytes + 1))).toThrow(
			expect.objectContaining({ code: "QUAKE.GIF.LIMIT" }),
		);
		for (const [width, height] of [
			[1025, 1],
			[1, 1025],
			[65535, 65535],
		])
			expect(() => decodeGif(repeatedTiny(1, width, height))).toThrow(
				expect.objectContaining({ code: "QUAKE.GIF.LIMIT" }),
			);
	});
	it("preflights frame and decoded-total limits before visiting malformed compressed data", () => {
		for (const [frames, width, height] of [
			[301, 1, 1],
			[33, 1024, 1024],
		] satisfies [number, number, number][]) {
			const bytes = repeatedTiny(frames, width, height);
			bytes[31] = 0; // Invalid first LZW stream must not run before the total-size preflight.
			expect(() => decodeGif(bytes)).toThrow(
				expect.objectContaining({ code: "QUAKE.GIF.LIMIT" }),
			);
		}
		expect(decodeGif(repeatedTiny(300)).frames).toHaveLength(300);
		expect(decodeGif(repeatedTiny(1, 1024, 1024)).frames[0]?.rgba).toHaveLength(
			1024 * 1024 * 4,
		);
	});
	it("rejects impossible encode metadata instead of rounding or allocating", () => {
		const base = still();
		for (const animation of [
			{ ...base, width: 1025 },
			{ ...base, frames: [] },
			{ ...base, frames: Array(301).fill(base.frames[0]) },
			{ ...base, loopCount: -1 },
			{ ...base, loopCount: 65536 },
			{ ...base, loopCount: 1.5 },
			...[-1, 1, 655360, Number.NaN].map((delayMs) => ({
				...base,
				frames: [{ rgba: pixels([1]), delayMs }],
			})),
			{ ...base, frames: [{ rgba: pixels([1, 2]), delayMs: 0 }] },
			{
				...base,
				width: 1024,
				height: 1024,
				frames: Array(33).fill(base.frames[0]),
			},
		])
			expect(() => encodeGif(animation)).toThrow(GifError);
	});
	it("caps the encoded byte writer before it grows beyond 8 MiB", () => {
		const writer = new Writer();
		for (let i = 0; i < GIF_LIMITS.maxBytes; i++) writer.byte(0);
		expect(() => writer.byte(0)).toThrow(
			expect.objectContaining({ code: "QUAKE.GIF.LIMIT" }),
		);
	});
	it("enforces the final file limit on real multi-frame compression", () => {
		const values = randomBytes(1024 * 1024);
		const rgba = new Uint8ClampedArray(values.length * 4);
		for (let i = 0; i < values.length; i++) {
			const v = (values[i] ?? 0) % 255;
			rgba.set([v, v, 255 - v, 255], i * 4);
		}
		expect(() =>
			encodeGif({
				width: 1024,
				height: 1024,
				loopCount: 0,
				frames: Array.from({ length: 8 }, () => ({ rgba, delayMs: 10 })),
			}),
		).toThrow(expect.objectContaining({ code: "QUAKE.GIF.LIMIT" }));
	}, 20000);
	it("rejects plain-text graphics, user-input waits and undefined disposal modes explicitly", () => {
		const tiny = fixtureBytes(tinyFixture);
		const extension = new Uint8Array([
			...tiny.subarray(0, 19),
			0x21,
			1,
			0,
			...tiny.subarray(19),
		]);
		expect(() => decodeGif(extension)).toThrow(
			expect.objectContaining({ code: "QUAKE.GIF.UNSUPPORTED" }),
		);
		for (const flags of [2, 16, 20, 24, 28]) {
			const bytes = new Uint8Array([
				...tiny.subarray(0, 19),
				0x21,
				0xf9,
				4,
				flags,
				0,
				0,
				0,
				0,
				...tiny.subarray(19),
			]);
			expect(() => decodeGif(bytes)).toThrow(
				expect.objectContaining({ code: "QUAKE.GIF.UNSUPPORTED" }),
			);
		}
	});
	it("never leaks input bytes or paths through validation errors", () => {
		try {
			decodeGif(new TextEncoder().encode("private/token"));
		} catch (cause) {
			expect(cause).toBeInstanceOf(GifError);
			expect(JSON.stringify(cause)).not.toMatch(/private|token/);
			expect(cause).toMatchObject({
				category: "validation",
				policy: { retry: "never" },
			});
		}
	});
});
