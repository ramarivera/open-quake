import { Deferred, Effect, Fiber, Schema, Stream } from "effect";
import { Segment } from "../../meetings/meeting-contracts.js";
import { isMeetingError, meetingError } from "../../meetings/meeting-errors.js";
import { asrTimeout } from "../../meetings/meeting-invariants.js";
import { AiProtocolInvalid } from "../ai-errors.js";
import type { MeetingAsrRequest } from "../meeting-adapter.js";
import type {
	MeetingResources,
	ResolveMeetingConnection,
} from "./meeting-resources.js";
import type { SpeechWebSocket } from "./speech-ports.js";
import {
	encodeAudio,
	receiveObject,
	sendEvent,
	withSocket,
} from "./speech-session.js";

/** File-only transcription. Each call owns PCM and a socket until every committed item is final. */
export const openaiMeeting = (
	transport: typeof SpeechWebSocket.Service,
	resources: MeetingResources,
	resolve: ResolveMeetingConnection,
) =>
	Effect.fn("OpenAIMeeting.transcribe")(function* (request: MeetingAsrRequest) {
		const connection = yield* resolve(request.config);
		return yield* Effect.acquireUseRelease(
			resources.pcm(request.audioRef),
			(audio) =>
				withSocket(
					transport,
					connection.realtime,
					{ Authorization: `Bearer ${connection.key}` },
					(socket) =>
						Effect.gen(function* () {
							const ready = yield* Deferred.make<
								void,
								import("../ai-errors.js").AiError
							>();
							const finished = yield* Deferred.make<
								void,
								import("../ai-errors.js").AiError
							>();
							const flushReady = yield* Deferred.make<
								void,
								import("../ai-errors.js").AiError
							>();
							let flushing = false;
							const flushId = crypto.randomUUID();
							const timings = new Map<
								string,
								{ startMs: number; endMs?: number }
							>();
							const items = new Map<
								string,
								{
									startMs: number;
									endMs: number;
									text?: string;
									previous?: string;
								}
							>();
							let eof = false;
							let committed = false;
							let sentMs = 0;
							let lastStart = 0;
							const complete = () =>
								eof &&
								committed &&
								[...items.values()].every((item) => item.text !== undefined);
							const reader = yield* Effect.gen(function* () {
								while (true) {
									const event = yield* receiveObject(socket);
									if (
										event.type === "error" &&
										eof &&
										typeof event.error === "object" &&
										event.error !== null &&
										"code" in event.error &&
										event.error.code === "input_audio_buffer_commit_empty" &&
										"event_id" in event.error &&
										event.error.event_id === flushId
									) {
										committed = true;
										if (complete())
											yield* Deferred.succeed(finished, undefined);
										continue;
									}
									if (
										event.type === "error" ||
										event.type ===
											"conversation.item.input_audio_transcription.failed"
									)
										return yield* new AiProtocolInvalid(event);
									if (
										event.type === "session.updated" ||
										event.type === "transcription_session.updated"
									)
										yield* Deferred.succeed(
											flushing ? flushReady : ready,
											undefined,
										);
									if (
										event.type === "input_audio_buffer.speech_started" &&
										typeof event.audio_start_ms === "number"
									) {
										lastStart = Math.max(0, Math.round(event.audio_start_ms));
										if (typeof event.item_id === "string") {
											if (timings.size >= 20000)
												return yield* new AiProtocolInvalid();
											// VAD IDs are provisional. A manual EOF commit can replace them.
											timings.set(event.item_id, { startMs: lastStart });
										}
									}
									if (
										event.type === "input_audio_buffer.speech_stopped" &&
										typeof event.item_id === "string" &&
										typeof event.audio_end_ms === "number"
									) {
										const item =
											timings.get(event.item_id) ?? items.get(event.item_id);
										if (item)
											item.endMs = Math.max(
												item.startMs,
												Math.round(event.audio_end_ms),
											);
									}
									if (event.type === "input_audio_buffer.committed") {
										if (
											typeof event.item_id !== "string" ||
											items.size >= 20000
										)
											return yield* new AiProtocolInvalid();
										const timing = timings.get(event.item_id);
										timings.delete(event.item_id);
										if (!items.has(event.item_id))
											items.set(event.item_id, {
												startMs: timing?.startMs ?? lastStart,
												endMs:
													timing?.endMs ??
													Math.max(timing?.startMs ?? lastStart, sentMs),
												...(typeof event.previous_item_id === "string"
													? { previous: event.previous_item_id }
													: {}),
											});
										if (eof) committed = true;
									}
									if (
										event.type ===
										"conversation.item.input_audio_transcription.completed"
									) {
										const id = event.item_id;
										const item =
											typeof id === "string" ? items.get(id) : undefined;
										if (
											!item ||
											typeof event.transcript !== "string" ||
											event.transcript.length > 1_000_000
										)
											return yield* new AiProtocolInvalid();
										item.text = event.transcript;
									}
									if (complete()) yield* Deferred.succeed(finished, undefined);
								}
							}).pipe(
								Effect.tapError((e) =>
									Deferred.fail(flushReady, e)
										.pipe(Effect.zipRight(Deferred.fail(ready, e)))
										.pipe(Effect.zipRight(Deferred.fail(finished, e))),
								),
								Effect.forkScoped,
							);
							yield* sendEvent(socket, {
								type: "session.update",
								session: {
									type: "realtime",
									output_modalities: ["text"],
									tools: [],
									tool_choice: "none",
									audio: {
										input: {
											format: { type: "audio/pcm", rate: 24000 },
											transcription: {
												model: "gpt-4o-transcribe",
												...(/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(
													request.config.outputLanguage,
												)
													? {
															language:
																request.config.outputLanguage.split("-")[0],
														}
													: {}),
											},
											noise_reduction: { type: "far_field" },
											turn_detection: {
												type: "server_vad",
												threshold: 0.4,
												prefix_padding_ms: 800,
												silence_duration_ms: 1000,
												create_response: false,
												interrupt_response: false,
											},
										},
									},
								},
							});
							yield* Deferred.await(ready).pipe(
								Effect.timeoutFail({
									duration: 10000,
									onTimeout: () => meetingError("Timeout"),
								}),
							);
							yield* Effect.sleep(500);
							yield* Stream.runForEach(audio.frames, (bytes) =>
								Effect.gen(function* () {
									if (!bytes.length || bytes.length > 30720 || bytes.length % 2)
										return yield* meetingError("Invalid");
									yield* sendEvent(socket, {
										type: "input_audio_buffer.append",
										audio: encodeAudio(bytes),
									}).pipe(
										Effect.mapError((cause) =>
											meetingError("TranscriptionFailed", cause),
										),
									);
									sentMs += bytes.length / 48;
									// Keep at least 20% of the overall deadline for server processing,
									// plus setup/final flush. Short files retain the normal 100ms pacing.
									yield* Effect.sleep(
										Math.min(
											100,
											(bytes.length / 48 / request.durationMs) *
												Math.max(
													0,
													asrTimeout("openai", request.durationMs) - 30000,
												) *
												0.8,
										),
									);
								}),
							);
							if (!sentMs) return yield* meetingError("NoValidSpeech");
							// Drain automatic VAD commits before requesting the final manual flush.
							// session.updated is ordered after prior audio and its VAD events.
							flushing = true;
							yield* sendEvent(socket, {
								type: "session.update",
								session: {
									type: "realtime",
									audio: { input: { turn_detection: null } },
								},
							});
							yield* Deferred.await(flushReady).pipe(
								Effect.timeoutFail({
									duration: 10000,
									onTimeout: () => meetingError("Timeout"),
								}),
							);
							eof = true;
							yield* sendEvent(socket, {
								type: "input_audio_buffer.commit",
								event_id: flushId,
							});
							yield* Deferred.await(finished).pipe(
								Effect.timeoutFail({
									duration: 10000,
									onTimeout: () => meetingError("Timeout"),
								}),
							);
							yield* Fiber.interrupt(reader);
							const ordered: (typeof Segment.Type)[] = [];
							const visited = new Set<string>();
							const add = (id: string): void => {
								if (visited.has(id)) return;
								visited.add(id);
								const item = items.get(id);
								if (!item) return;
								if (item.previous) add(item.previous);
								ordered.push({
									id,
									speaker: "",
									startMs: Math.min(
										Math.round(request.durationMs),
										item.startMs,
									),
									endMs: Math.min(Math.round(request.durationMs), item.endMs),
									text: item.text ?? "",
								});
							};
							for (const id of items.keys()) add(id);
							if (!ordered.some((s) => s.text.trim()))
								return yield* meetingError("NoValidSpeech");
							const segments = yield* Schema.decodeUnknown(
								Schema.Array(Segment),
							)(ordered).pipe(
								Effect.mapError((cause) =>
									meetingError("TranscriptionFailed", cause),
								),
							);
							yield* resources.artifacts(
								request.audioRef,
								[...items.entries()],
								segments,
							);
							return segments;
						}),
				),
			(audio) => audio.release,
		).pipe(
			Effect.mapError((cause) =>
				isMeetingError(cause)
					? cause
					: meetingError("TranscriptionFailed", cause),
			),
		);
	});
