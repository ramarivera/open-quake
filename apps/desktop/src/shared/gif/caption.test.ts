import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type CaptionSettings,
	captionGif,
	captionTextWeight,
	stillImageGif,
} from "../../renderer/src/management/emoji/caption";
import { fixtureBytes, pngFixture, retainFixture } from "./fixtures";
import { decodeGif, GifError } from "./index";

function fakeCanvas() {
	let pixels = new Uint8ClampedArray(0);
	const sourceFrames: Uint8ClampedArray[] = [];
	const context = {
		sourceFrames,
		font: "",
		textAlign: "",
		textBaseline: "",
		lineJoin: "",
		lineWidth: 0,
		strokeStyle: "",
		fillStyle: "",
		createImageData: (width: number, height: number) => ({
			data: new Uint8ClampedArray(width * height * 4),
		}),
		putImageData: vi.fn((image: { data: Uint8ClampedArray }) => {
			pixels = image.data.slice();
			context.sourceFrames.push(pixels.slice());
		}),
		getImageData: vi.fn(() => ({ data: pixels.slice() })),
		strokeText: vi.fn(),
		fillText: vi.fn((text: string) => {
			pixels[0] = text === "Hi" ? 1 : 2;
		}),
		drawImage: vi.fn(() => {
			pixels = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]);
		}),
	};
	vi.stubGlobal("document", {
		createElement: () => ({ width: 0, height: 0, getContext: () => context }),
		fonts: { ready: Promise.resolve() },
	});
	return context;
}
afterEach(() => vi.unstubAllGlobals());

describe("caption canvas consumer", () => {
	it("starts every caption edit and every frame from the original composited pixels", async () => {
		const context = fakeCanvas();
		const bytes = fixtureBytes(retainFixture);
		const snapshot = bytes.slice();
		const original = decodeGif(bytes);
		await captionGif(bytes, { text: "Hi" });
		const result = decodeGif(await captionGif(bytes, { text: "Bye" }));
		expect(bytes).toEqual(snapshot);
		expect(result.frames.map((frame) => frame.delayMs)).toEqual(
			original.frames.map((frame) => frame.delayMs),
		);
		expect([result.width, result.height, result.loopCount]).toEqual([4, 3, 7]);
		for (let i = 0; i < 4; i++) {
			expect(result.frames[i]?.rgba[0]).toBe(2);
			expect(context.sourceFrames[i]).toEqual(original.frames[i]?.rgba);
			expect(context.sourceFrames[i + 4]).toEqual(original.frames[i]?.rgba);
		}
		expect(context.strokeText).toHaveBeenCalledTimes(8);
		expect(context.fillText).toHaveBeenCalledTimes(8);
		expect(context.font).toBe("800 48px sans-serif");
		expect(context.strokeStyle).toBe("rgba(0, 0, 0, 0.85)");
		expect(context.fillStyle).toBe("rgba(255, 255, 255, 1)");
		expect(context.textBaseline).toBe("bottom");
	});
	it("honours size, alpha and all position choices", async () => {
		const bytes = fixtureBytes(retainFixture);
		for (const position of [
			"top",
			"mid",
			"bot",
		] satisfies CaptionSettings["position"][]) {
			const context = fakeCanvas();
			await captionGif(bytes, {
				text: "Hi",
				size: 12,
				color: "0x11223380",
				position,
			});
			expect(context.font).toBe("800 12px sans-serif");
			expect(context.fillStyle).toBe(`rgba(17, 34, 51, ${128 / 255})`);
			expect(context.textBaseline).toBe(
				position === "top" ? "top" : position === "mid" ? "middle" : "bottom",
			);
			expect(context.fillText.mock.calls[0]?.slice(1, 3)).toEqual([
				2,
				position === "top" ? 0.75 : position === "mid" ? 1.5 : 2.25,
			]);
		}
	});
	it("counts CJK as two and other UTF-16 units as one", () => {
		expect(captionTextWeight("A中😀")).toBe(5);
		expect(captionTextWeight("中".repeat(25))).toBe(50);
		expect(captionTextWeight("😀".repeat(25))).toBe(50);
	});
	it("rejects excessive weighted text, fractional/out-of-range sizes and malformed colours", async () => {
		const bytes = fixtureBytes(retainFixture);
		const settings: CaptionSettings[] = [
			{ text: "中".repeat(26) },
			{ text: "x".repeat(51) },
			{ text: "😀".repeat(26) },
			...[11, 101, 12.5, Number.NaN].map((size) => ({ text: "Hi", size })),
			...["white", "#ffffffff", "0xffffff", "0xggffffff", "0x123456789"].map(
				(color) => ({ text: "Hi", color }),
			),
		];
		for (const value of settings)
			await expect(captionGif(bytes, value)).rejects.toMatchObject({
				code: "QUAKE.GIF.CAPTION_SETTINGS",
			});
	});
	it("accepts boundary settings and clears captions to a validated copy of the source", async () => {
		const context = fakeCanvas();
		const bytes = fixtureBytes(retainFixture);
		await captionGif(bytes, {
			text: "中".repeat(25),
			size: 100,
			color: "0x00000000",
		});
		expect(context.font).toBe("800 100px sans-serif");
		const cleared = await captionGif(bytes, { text: "" });
		expect(cleared).toEqual(bytes);
		expect(cleared).not.toBe(bytes);
		await expect(
			captionGif(new Uint8Array(0), { text: "" }),
		).rejects.toMatchObject({ code: "QUAKE.GIF.INVALID" });
	});
	it("reports unavailable/failed canvas operations with stable, scrubbed errors", async () => {
		vi.stubGlobal("document", undefined);
		const bytes = fixtureBytes(retainFixture);
		await expect(captionGif(bytes, { text: "Hi" })).rejects.toMatchObject({
			code: "QUAKE.GIF.CANVAS_UNAVAILABLE",
		});
		const context = fakeCanvas();
		const original = new Error("private/token");
		context.strokeText.mockImplementation(() => {
			throw original;
		});
		try {
			await captionGif(bytes, { text: "Hi" });
		} catch (cause) {
			expect(cause).toBeInstanceOf(GifError);
			if (!(cause instanceof GifError)) return;
			expect(cause.code).toBe("QUAKE.GIF.CANVAS_UNAVAILABLE");
			expect(cause.originalCause).toBe(original);
			expect(JSON.stringify(cause)).not.toMatch(/private|token/);
		}
	});
});

describe("still image canvas import", () => {
	it("imports a validated PNG as one full-canvas frame without a loop extension", async () => {
		fakeCanvas();
		vi.stubGlobal(
			"Image",
			class {
				src = "";
				naturalWidth = 2;
				naturalHeight = 1;
				async decode() {}
			},
		);
		const result = decodeGif(
			await stillImageGif(`data:image/png;base64,${pngFixture}`),
		);
		expect([
			result.width,
			result.height,
			result.loopCount,
			result.frames.length,
			result.frames[0]?.delayMs,
		]).toEqual([2, 1, null, 1, 0]);
		expect(result.frames[0]?.rgba).toEqual(
			new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]),
		);
	});
	it("rejects remote URLs, other formats, false signatures and malformed base64", async () => {
		for (const source of [
			"https://private/image.png",
			"data:image/svg+xml;base64,PHN2Zz4=",
			"data:image/gif;base64,R0lG",
			"data:image/png;base64,AA==",
			"data:image/png;base64,@@@=",
			"data:image/jpeg;base64,AA==",
			"data:image/png;base64,AAA",
		]) {
			await expect(stillImageGif(source)).rejects.toMatchObject({
				code: "QUAKE.GIF.IMAGE_INVALID",
			});
		}
	});
	it("rejects dimensions and byte lengths before constructing a native image", async () => {
		let allocations = 0;
		vi.stubGlobal(
			"Image",
			class {
				constructor() {
					allocations++;
				}
			},
		);
		const bytes = fixtureBytes(pngFixture);
		bytes[16] = 1;
		await expect(
			stillImageGif(
				`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
			),
		).rejects.toMatchObject({ code: "QUAKE.GIF.LIMIT" });
		await expect(
			stillImageGif(`data:image/png;base64,${"A".repeat(12 * 1024 * 1024)}`),
		).rejects.toMatchObject({ code: "QUAKE.GIF.LIMIT" });
		expect(allocations).toBe(0);
	});
	it("propagates a native decode failure without exposing the original diagnostic", async () => {
		const original = new Error("private/token");
		vi.stubGlobal(
			"Image",
			class {
				src = "";
				async decode() {
					throw original;
				}
			},
		);
		await expect(
			stillImageGif(`data:image/png;base64,${pngFixture}`),
		).rejects.toMatchObject({
			code: "QUAKE.GIF.IMAGE_INVALID",
			originalCause: original,
		});
	});
});
