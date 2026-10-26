import { Effect } from "effect";
import { AiProtocolInvalid } from "../ai-errors.js";
import { MAX_AUDIO_BYTES, verifiedAudio } from "./speech-audio.js";
import type { TtsProfile } from "./speech-contracts.js";
import type { SpeechWebSocket } from "./speech-ports.js";
import {
	decodeAudio,
	object,
	phase,
	receiveObject,
	sendEvent,
	withSocket,
} from "./speech-session.js";

export function synthesizeQwenRealtime(
	transport: typeof SpeechWebSocket.Service,
	profile: TtsProfile,
	key: string,
	text: string,
	onAudio: () => void,
) {
	return withSocket(
		transport,
		profile.baseUrl,
		{ Authorization: `Bearer ${key}` },
		(socket) =>
			Effect.gen(function* () {
				let completed = false;
				yield* Effect.addFinalizer(() =>
					Effect.gen(function* () {
						if (!completed)
							yield* sendEvent(socket, {
								type: "input_text_buffer.clear",
							}).pipe(Effect.ignore);
						yield* sendEvent(socket, { type: "session.finish" }).pipe(
							Effect.ignore,
						);
					}).pipe(Effect.timeoutOption("1 second"), Effect.asVoid),
				);
				yield* phase(
					Effect.gen(function* () {
						yield* sendEvent(socket, {
							type: "session.update",
							session: {
								mode: "commit",
								voice: profile.voice,
								response_format: "pcm",
								sample_rate: 24000,
							},
						});
						while (true) {
							const event = yield* receiveObject(socket);
							if (event.type === "session.updated") break;
							if (event.type === "error")
								return yield* new AiProtocolInvalid(event);
						}
					}),
					"configure",
				);
				yield* sendEvent(socket, { type: "input_text_buffer.append", text });
				yield* sendEvent(socket, { type: "input_text_buffer.commit" });
				const chunks: Uint8Array[] = [];
				let length = 0;
				let responseId: string | undefined;
				while (true) {
					const event = yield* receiveObject(socket);
					if (event.type === "error")
						return yield* new AiProtocolInvalid(event);
					if (event.type === "response.created") {
						const id = object(event.response).id;
						if (typeof id !== "string" || responseId)
							return yield* new AiProtocolInvalid();
						responseId = id;
					}
					if (event.type === "response.audio.delta") {
						if (!responseId || event.response_id !== responseId)
							return yield* new AiProtocolInvalid();
						const bytes = yield* decodeAudio(event.delta);
						length += bytes.length;
						if (length > MAX_AUDIO_BYTES || bytes.length % 2)
							return yield* new AiProtocolInvalid();
						chunks.push(bytes);
						if (bytes.length) onAudio();
					}
					if (event.type === "response.done") {
						if (
							!responseId ||
							object(event.response).id !== responseId ||
							object(event.response).status !== "completed"
						)
							return yield* new AiProtocolInvalid();
						completed = true;
						break;
					}
				}
				const bytes = new Uint8Array(length);
				let offset = 0;
				for (const c of chunks) {
					bytes.set(c, offset);
					offset += c.length;
				}
				return yield* verifiedAudio(bytes, "pcm");
			}),
	);
}
