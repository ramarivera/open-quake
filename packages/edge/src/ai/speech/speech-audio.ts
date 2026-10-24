import { Either } from "effect";
import type { GeneratedAudio } from "./speech-contracts.js";
import { PCM_24K } from "./speech-contracts.js";
import { SpeechFormatUnsupported } from "./speech-errors.js";

export const MAX_AUDIO_BYTES = 24000 * 2 * 120 + 4096;
/** Verify bounded 24kHz mono PCM, including completed streaming WAV responses.
 * Only RIFF and final data lengths may use 0xffffffff; other chunk sizes,
 * PCM descriptors and sample alignment remain strict. */
export function verifiedAudio(
	bytes: Uint8Array,
	format: "pcm" | "wav",
): Either.Either<GeneratedAudio, SpeechFormatUnsupported> {
	const fail = () => Either.left(new SpeechFormatUnsupported());
	if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) return fail();
	let sampleBytes = bytes.length;
	if (format === "wav") {
		if (bytes.length < 44) return fail();
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const four = (offset: number) =>
			String.fromCharCode(...bytes.subarray(offset, offset + 4));
		const streamingSize = 0xffffffff;
		const riffSize = view.getUint32(4, true);
		if (
			four(0) !== "RIFF" ||
			four(8) !== "WAVE" ||
			(riffSize !== streamingSize && riffSize + 8 !== bytes.length)
		)
			return fail();
		let fmt = false;
		let data = false;
		let offset = 12;
		sampleBytes = 0;
		while (offset + 8 <= bytes.length) {
			let size = view.getUint32(offset + 4, true);
			if (size === streamingSize && four(offset) === "data") {
				// Unknown-length data owns the remaining response, so its format
				// must already be known and no later chunk can be parsed.
				if (!fmt) return fail();
				size = bytes.length - offset - 8;
			}
			const end = offset + 8 + size;
			if (end > bytes.length) return fail();
			if (four(offset) === "fmt ") {
				if (
					fmt ||
					size < 16 ||
					view.getUint16(offset + 8, true) !== 1 ||
					view.getUint16(offset + 10, true) !== 1 ||
					view.getUint32(offset + 12, true) !== 24000 ||
					view.getUint32(offset + 16, true) !== 48000 ||
					view.getUint16(offset + 20, true) !== 2 ||
					view.getUint16(offset + 22, true) !== 16
				)
					return fail();
				fmt = true;
			}
			if (four(offset) === "data") {
				if (data) return fail();
				data = true;
				sampleBytes = size;
			}
			offset = end + (size % 2);
		}
		if (!fmt || !data || offset !== bytes.length) return fail();
	}
	if (!sampleBytes || sampleBytes % 2 !== 0 || sampleBytes / 48 > 120000)
		return fail();
	return Either.right({
		bytes,
		descriptor: PCM_24K,
		format,
		durationMs: sampleBytes / 48,
		provenance: "generation",
	});
}
