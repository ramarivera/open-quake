import { Effect, Either, Redacted, Schema } from "effect";
import {
	AiAuthRequired,
	type AiError,
	AiProtocolInvalid,
	AiRateLimited,
	AiUnavailable,
	translateProviderFailure,
} from "../ai-errors.js";
import { MAX_AUDIO_BYTES, verifiedAudio } from "./speech-audio.js";
import type { GeneratedAudio, TtsProfile } from "./speech-contracts.js";
import { SpeechFormatUnsupported } from "./speech-errors.js";
import type { SpeechHttp } from "./speech-ports.js";

export type SynthesisError = AiError | SpeechFormatUnsupported;
const Frame = Schema.Struct({
	output: Schema.Struct({
		audio: Schema.optional(
			Schema.Struct({ data: Schema.optional(Schema.String) }),
		),
		finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
	}),
	code: Schema.optional(Schema.String),
});
const parseFrame = Schema.decodeUnknownSync(Schema.parseJson(Frame));

async function readAudio(
	response: Response,
	format: "wav" | "pcm",
	signal: AbortSignal,
	onAudio: () => void,
): Promise<Uint8Array> {
	if (!response.body) throw new AiProtocolInvalid();
	const reader = response.body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	let line = "";
	let data: string[] = [];
	let stopped = false;
	// Both null encodings mean progress. Only stop completes synthesis, and
	// records after it are invalid even if they carry no audio.
	const record = () => {
		if (!data.length) return;
		if (stopped) throw new AiProtocolInvalid();
		const frame = parseFrame(data.join("\n"));
		data = [];
		if (frame.code && frame.code !== "200" && frame.code !== "Success")
			throw new AiProtocolInvalid(frame);
		const encoded = frame.output.audio?.data;
		if (encoded) {
			if (
				!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
					encoded,
				)
			)
				throw new AiProtocolInvalid();
			const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
			bytes += decoded.length;
			if (bytes > MAX_AUDIO_BYTES) throw new SpeechFormatUnsupported();
			chunks.push(decoded);
			if (decoded.length) onAudio();
		}
		const reason = frame.output.finish_reason;
		if (reason !== undefined && reason !== null && reason !== "null") {
			if (reason !== "stop") throw new AiProtocolInvalid(frame);
			stopped = true;
		}
	};
	const consume = (text: string) => {
		line += text;
		if (line.length > MAX_AUDIO_BYTES * 2) throw new AiProtocolInvalid();
		let index = line.indexOf("\n");
		while (index >= 0) {
			const current = line.slice(0, index).replace(/\r$/, "");
			line = line.slice(index + 1);
			if (current === "") record();
			else if (current.startsWith("data:"))
				data.push(current.slice(5).replace(/^ /, ""));
			if (data.join("").length > MAX_AUDIO_BYTES * 2)
				throw new AiProtocolInvalid();
			index = line.indexOf("\n");
		}
	};
	try {
		while (true) {
			const chunk = await reader.read();
			if (signal.aborted) throw new AiUnavailable();
			if (chunk.done) break;
			if (format === "wav") {
				bytes += chunk.value.length;
				if (bytes > MAX_AUDIO_BYTES) throw new SpeechFormatUnsupported();
				chunks.push(chunk.value);
				if (chunk.value.length) onAudio();
			} else consume(decoder.decode(chunk.value, { stream: true }));
		}
		if (format === "pcm") {
			consume(decoder.decode());
			if (line.trim() || data.length || !stopped) throw new AiProtocolInvalid();
		}
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
	const combined = new Uint8Array(bytes);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.length;
	}
	return combined;
}

/** Synthesize through independent HTTP with no retry or provider fallback.
 * Fragmented SSE must end in stop; WAV is verified after bounded assembly. */
export function synthesizeHttp(
	http: typeof SpeechHttp.Service,
	profile: TtsProfile,
	text: string,
	key: Redacted.Redacted<string>,
	onAudio: () => void = () => {},
): Effect.Effect<GeneratedAudio, SynthesisError> {
	return Effect.tryPromise({
		try: async (signal) => {
			const openai = profile.provider === "openai";
			const url = `${profile.baseUrl.replace(/\/$/, "")}${openai ? "/audio/speech" : "/api/v1/services/audio/tts/SpeechSynthesizer"}`;
			const response = await http.fetch(url, {
				method: "POST",
				redirect: "error",
				signal,
				headers: {
					Authorization: `Bearer ${Redacted.value(key)}`,
					"Content-Type": "application/json",
					...(openai ? {} : { "X-DashScope-SSE": "enable" }),
				},
				body: JSON.stringify(
					openai
						? {
								model: profile.model,
								voice: profile.voice,
								input: text,
								instructions: profile.instructions,
								response_format: "wav",
							}
						: {
								model: profile.model,
								input: {
									text,
									voice: profile.voice,
									format: "pcm",
									sample_rate: 24000,
								},
							},
				),
			});
			if (!response.ok) {
				await response.body?.cancel();
				throw translateProviderFailure(response.status, response);
			}
			const contentType = response.headers
				.get("content-type")
				?.split(";")[0]
				?.trim();
			if (
				openai
					? contentType !== "audio/wav" && contentType !== "audio/x-wav"
					: contentType !== "text/event-stream"
			) {
				await response.body?.cancel();
				throw new SpeechFormatUnsupported();
			}
			const bytes = await readAudio(response, profile.format, signal, onAudio);
			const audio = verifiedAudio(bytes, profile.format);
			if (Either.isLeft(audio)) throw audio.left;
			return audio.right;
		},
		catch: (cause) =>
			cause instanceof SpeechFormatUnsupported ||
			cause instanceof AiProtocolInvalid ||
			cause instanceof AiRateLimited ||
			cause instanceof AiAuthRequired ||
			cause instanceof AiUnavailable
				? cause
				: new AiProtocolInvalid(cause),
	});
}
