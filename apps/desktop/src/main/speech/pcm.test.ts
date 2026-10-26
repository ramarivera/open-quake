import { describe, expect, it } from "vitest";
import { PcmFramer } from "./pcm";

describe("capture PCM", () => {
	it("resamples split 48kHz stereo blocks to exact 20ms mono s16le with correlated sequence and normalized RMS", () => {
		const framer = new PcmFramer("capture", 48000);
		const frames = [
			...framer.push([
				new Float32Array(481).fill(1),
				new Float32Array(481).fill(0),
			]),
			...framer.push([
				new Float32Array(479).fill(1),
				new Float32Array(479).fill(0),
			]),
			...framer.push([
				new Float32Array(240).fill(-1),
				new Float32Array(240).fill(-1),
			]),
			...framer.flush(),
		];
		expect(
			frames.map((frame) => [
				frame.captureId,
				frame.seq,
				frame.bytes.length,
				frame.rms,
			]),
		).toEqual([
			["capture", 0, 960, 0.5],
			["capture", 1, 240, 1],
		]);
		if (!frames[0] || !frames[1]) throw new Error("missing PCM fixtures");
		expect(new DataView(frames[0].bytes.buffer).getInt16(0, true)).toBe(16384);
		expect(new DataView(frames[1].bytes.buffer).getInt16(0, true)).toBe(-32768);
	});
	it("preserves nonintegral 44.1kHz phase across arbitrary input blocks", () => {
		const whole = new PcmFramer("a", 44100),
			split = new PcmFramer("a", 44100);
		const samples = Float32Array.from({ length: 4410 }, (_, index) =>
			Math.sin(index / 12),
		);
		const expected = [...whole.push([samples]), ...whole.flush()].flatMap(
			(frame) => Array.from(frame.bytes),
		);
		const actual = [];
		for (let offset = 0; offset < samples.length; offset += 137)
			actual.push(...split.push([samples.subarray(offset, offset + 137)]));
		actual.push(...split.flush());
		expect(actual.flatMap((frame) => Array.from(frame.bytes))).toEqual(
			expected,
		);
		expect(expected.length).toBe(4800);
	});
});

for (const rate of [
	8000, 11025, 16000, 22050, 24000, 44100, 48000, 96000, 192000,
]) {
	it(`frames mono and stereo ${rate}Hz into fixed 24kHz s16le without losing split-block phase`, () => {
		for (const channels of [1, 2]) {
			const framer = new PcmFramer("rates", rate);
			const samples = Math.round(rate / 10);
			const frames = [];
			for (let i = 0; i < samples; i += 137)
				frames.push(
					...framer.push(
						Array.from({ length: channels }, () =>
							new Float32Array(Math.min(137, samples - i)).fill(0.5),
						),
					),
				);
			frames.push(...framer.flush());
			expect(frames.flatMap((f) => Array.from(f.bytes))).toHaveLength(
				Math.floor((samples * 24000) / rate) * 2,
			);
			expect(frames.map((f) => f.seq)).toEqual(frames.map((_, i) => i));
			expect(frames.every((f) => f.peak === 0.5 && f.rms === 0.5)).toBe(true);
		}
	});
}
