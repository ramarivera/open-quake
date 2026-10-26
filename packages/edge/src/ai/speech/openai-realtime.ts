import { Deferred, Effect, Fiber, type Stream } from "effect";
import { type AiError, AiProtocolInvalid } from "../ai-errors.js";
import type { SttProfile } from "./speech-contracts.js";
import type { SpeechWebSocket } from "./speech-ports.js";
import {
	encodeAudio,
	phase,
	receiveObject,
	sendEvent,
	sendFrames,
	withSocket,
} from "./speech-session.js";
import type { Transcript } from "./speech-stt.js";

/** Direct transcription-only GA API. No response creation, assistant or tool loop. */
export function recognizeOpenAI(
	transport: typeof SpeechWebSocket.Service,
	profile: SttProfile,
	key: string,
	frames: Stream.Stream<Uint8Array, AiError>,
	onTranscript: (t: Transcript) => Effect.Effect<void>,
) {
	return withSocket(
		transport,
		profile.baseUrl,
		{ Authorization: `Bearer ${key}` },
		(socket) =>
			Effect.gen(function* () {
				const ready = yield* Deferred.make<void>();
				const result = yield* Deferred.make<string, AiError>();
				const items = new Map<
					string,
					{ text: string; final: boolean; previous?: string | undefined }
				>();
				let pendingAudio = false;
				let finishing = false;
				let commitPending = false;
				const text = () => {
					const ordered: string[] = [];
					const visited = new Set<string>();
					const add = (id: string): void => {
						if (visited.has(id)) return;
						visited.add(id);
						const item = items.get(id);
						if (!item) return;
						if (item.previous) add(item.previous);
						ordered.push(item.text);
					};
					for (const id of items.keys()) add(id);
					return ordered.join("");
				};
				const complete = () =>
					Effect.gen(function* () {
						if (
							finishing &&
							!commitPending &&
							!pendingAudio &&
							[...items.values()].every((i) => i.final)
						) {
							yield* onTranscript({ text: text(), final: true });
							yield* Deferred.succeed(result, text());
						}
					});
				const reader = Effect.gen(function* () {
					while (true) {
						const event = yield* receiveObject(socket);
						if (
							event.type === "error" ||
							event.type ===
								"conversation.item.input_audio_transcription.failed"
						)
							return yield* new AiProtocolInvalid(event);
						if (event.type === "session.updated") {
							yield* Deferred.succeed(ready, undefined);
							continue;
						}
						if (event.type === "input_audio_buffer.committed") {
							if (typeof event.item_id !== "string")
								return yield* new AiProtocolInvalid();
							const old = items.get(event.item_id);
							items.set(event.item_id, {
								...old,
								text: old?.text ?? "",
								final: old?.final ?? false,
								previous:
									typeof event.previous_item_id === "string"
										? event.previous_item_id
										: undefined,
							});
							commitPending = false;
							pendingAudio = false;
							yield* complete();
						}
						if (
							event.type ===
								"conversation.item.input_audio_transcription.delta" ||
							event.type ===
								"conversation.item.input_audio_transcription.completed"
						) {
							if (
								typeof event.item_id !== "string" ||
								!items.has(event.item_id)
							)
								return yield* new AiProtocolInvalid();
							const old = items.get(event.item_id);
							if (!old || old.final) continue;
							const final =
								event.type ===
								"conversation.item.input_audio_transcription.completed";
							const value = final ? event.transcript : event.delta;
							if (typeof value !== "string")
								return yield* new AiProtocolInvalid();
							items.set(event.item_id, {
								...old,
								text: final ? value : old.text + value,
								final,
							});
							if (text().length > 64000 || items.size > 3000)
								return yield* new AiProtocolInvalid();
							yield* onTranscript({ text: text(), final: false });
							yield* complete();
						}
					}
				});
				const fiber = yield* reader.pipe(
					Effect.catchAll((e) => Deferred.fail(result, e)),
					Effect.forkScoped,
				);
				const sender = Effect.gen(function* () {
					yield* phase(
						sendEvent(socket, {
							type: "session.update",
							session: {
								type: "transcription",
								audio: {
									input: {
										format: { type: "audio/pcm", rate: 24000 },
										transcription: {
											model: profile.model,
											language: profile.language ?? "en",
										},
										turn_detection: null,
									},
								},
							},
						}).pipe(Effect.zipRight(Deferred.await(ready))),
						"configure",
					);
					const count = yield* sendFrames(frames, (bytes) =>
						Effect.gen(function* () {
							pendingAudio = true;
							yield* sendEvent(socket, {
								type: "input_audio_buffer.append",
								audio: encodeAudio(bytes),
							});
						}),
					);
					if (!count) return "";
					finishing = true;
					return yield* phase(
						Effect.gen(function* () {
							if (pendingAudio) {
								commitPending = true;
								yield* sendEvent(socket, { type: "input_audio_buffer.commit" });
							}
							yield* complete();
							return yield* Deferred.await(result);
						}),
						"final",
					);
				});
				const value = yield* Effect.raceFirst(
					sender,
					Deferred.await(result).pipe(Effect.zipRight(Effect.never)),
				);
				yield* Fiber.interrupt(fiber);
				return value;
			}),
	);
}
