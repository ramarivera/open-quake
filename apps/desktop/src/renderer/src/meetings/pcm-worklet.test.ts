import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it.each([16000, 24000, 44100, 48000, 96000])(
	"resamples actual %i Hz to exact 300 ms s16le mono with silent output",
	(rate) => {
		const frames: ArrayBuffer[] = [];
		let processor:
			| { process: (input: Float32Array[][]) => boolean }
			| undefined;
		runInNewContext(
			readFileSync(new URL("./pcm-worklet.js", import.meta.url), "utf8"),
			{
				AudioWorkletProcessor: class {
					port = { postMessage: (bytes: ArrayBuffer) => frames.push(bytes) };
				},
				sampleRate: rate,
				registerProcessor: (
					_name: string,
					Constructor: new () => {
						process: (input: Float32Array[][]) => boolean;
					},
				) => {
					processor = new Constructor();
				},
			},
		);
		if (!processor) throw new Error("Missing worklet");
		for (let start = 0; start < rate * 0.9; start += 128) {
			const length = Math.min(128, rate * 0.9 - start);
			expect(
				processor.process([
					[
						new Float32Array(length).fill(1),
						new Float32Array(length).fill(-0.5),
					],
				]),
			).toBe(true);
		}
		expect(frames).toHaveLength(3);
		for (const frame of frames) {
			expect(frame.byteLength).toBe(14400);
			const view = new DataView(frame);
			expect(view.getInt16(0, true)).toBe(8192);
			expect(view.getInt16(14398, true)).toBe(8192);
		}
	},
);
