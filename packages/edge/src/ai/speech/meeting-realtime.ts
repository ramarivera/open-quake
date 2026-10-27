import { Clock, Deferred, Effect, Fiber, Scope } from "effect";
import type {
	MeetingConfig,
	Translation,
} from "../../meetings/meeting-contracts.js";
import { meetingError } from "../../meetings/meeting-errors.js";
import { AiProtocolInvalid } from "../ai-errors.js";
import type { ResolveMeetingConnection } from "./meeting-resources.js";
import type { SpeechSocket, SpeechWebSocket } from "./speech-ports.js";
import { pcmResampler } from "./speech-resample.js";
import {
	encodeAudio,
	object,
	receiveObject,
	sendEvent,
} from "./speech-session.js";

/** One app-owned translation session. Host socket and PCM queues are bounded independently. */
export const makeMeetingTranslation = Effect.fn("MeetingTranslation.make")(
	function* (
		transport: typeof SpeechWebSocket.Service,
		resolve: ResolveMeetingConnection,
	) {
		const scope = yield* Scope.Scope;
		let active:
			| {
					config: string;
					socket: SpeechSocket;
					controller: AbortController;
					reader: Fiber.RuntimeFiber<void, never>;
			  }
			| undefined;
		let updates: Translation[] = [];
		let connecting: AbortController | undefined;
		let generation = 0;
		let connectionEpoch = 0;
		let reconnectAt = 0;
		let queued = 0;
		const gate = yield* Effect.makeSemaphore(1);
		const stop = Effect.fn("MeetingTranslation.stop")(() =>
			Effect.gen(function* () {
				generation++;
				connecting?.abort();
				connecting = undefined;
				const old = active;
				active = undefined;
				updates = [];
				reconnectAt = 0;
				if (old) {
					old.controller.abort();
					yield* old.socket.close;
					yield* Fiber.interrupt(old.reader);
				}
			}),
		);
		yield* Effect.addFinalizer(stop);
		const prepare = Effect.fn("MeetingTranslation.prepare")(
			(config: MeetingConfig, expected = generation) =>
				gate.withPermits(1)(
					Effect.gen(function* () {
						if (expected !== generation)
							return yield* meetingError("Unavailable");
						const identity = JSON.stringify([
							config.profileId,
							config.translationModel,
							config.targetLanguage,
						]);
						if (active?.config === identity) return;
						if (active) yield* stop();
						const epoch = generation;
						const wait = reconnectAt - (yield* Clock.currentTimeMillis);
						if (wait > 0) yield* Effect.sleep(wait);
						if (generation !== epoch) return yield* meetingError("Unavailable");
						const connection = yield* resolve(config, true);
						if (generation !== epoch) return yield* meetingError("Unavailable");
						const controller = new AbortController();
						connecting = controller;
						const sessionId = connectionEpoch++;
						const socket = yield* transport
							.connect({
								url: connection.realtime,
								headers: { Authorization: `Bearer ${connection.key}` },
								signal: controller.signal,
							})
							.pipe(
								Effect.mapError((cause) => meetingError("Unavailable", cause)),
								Effect.timeoutFail({
									duration: 10000,
									onTimeout: () => meetingError("Timeout"),
								}),
								Effect.onError(() => Effect.sync(() => controller.abort())),
							);
						const ready = yield* Deferred.make<
							void,
							import("../ai-errors.js").AiError
						>();
						const text = new Map<string, string>();
						const speakers = new Map<string, string>();
						const rememberSpeaker = (id: unknown, speaker: unknown) => {
							if (
								typeof id !== "string" ||
								id.length > 256 ||
								(typeof speaker !== "string" && typeof speaker !== "number")
							)
								return;
							speakers.set(id, String(speaker).slice(0, 256));
							while (speakers.size > 200) {
								const first = speakers.keys().next().value;
								if (first !== undefined) speakers.delete(first);
							}
						};
						let disconnected = false;
						const reader = yield* Effect.gen(function* () {
							while (true) {
								const event = yield* receiveObject(socket);
								if (generation !== epoch) return;
								if (event.type === "session.updated")
									yield* Deferred.succeed(ready, undefined);
								if (event.type === "input_audio_buffer.speech_started")
									rememberSpeaker(event.item_id, event.speaker_id);
								if (event.type === "conversation.item.created") {
									const item = object(event.item);
									const previous =
										event.previous_item_id ?? item.previous_item_id;
									rememberSpeaker(
										item.id,
										typeof previous === "string"
											? speakers.get(previous)
											: undefined,
									);
								}
								if (event.type === "error")
									return yield* new AiProtocolInvalid();
								if (
									![
										"response.text.delta",
										"response.text.text",
										"response.text.done",
									].includes(String(event.type))
								)
									continue;
								const id =
									typeof event.item_id === "string"
										? event.item_id
										: typeof event.response_id === "string"
											? event.response_id
											: undefined;
								if (!id || id.length > 256) continue;
								const value =
									event.type === "response.text.text" &&
									typeof event.text === "string"
										? event.text +
											(typeof event.stash === "string" ? event.stash : "")
										: (event.delta ?? event.text);
								if (typeof value !== "string") continue;
								const final = event.type === "response.text.done";
								const content = (
									event.type === "response.text.delta"
										? (text.get(id) ?? "") + value
										: value
								).slice(0, 4000);
								if (final) text.delete(id);
								else text.set(id, content);
								while (text.size > 8) {
									const first = text.keys().next().value;
									if (first !== undefined) text.delete(first);
								}
								const updateId = `${sessionId}:${id}`;
								const previous = updates.findIndex((u) => u.id === updateId);
								if (previous >= 0 && updates[previous]?.final) continue;
								if (previous >= 0) updates.splice(previous, 1);
								updates.push({
									id: updateId,
									speaker:
										typeof event.speaker_id === "string" ||
										typeof event.speaker_id === "number"
											? String(event.speaker_id)
											: (speakers.get(id) ?? ""),
									text: content,
									final,
									at: yield* Clock.currentTimeMillis,
								});
								while (
									updates.length > 200 ||
									updates.reduce((n, u) => n + u.text.length, 0) > 64000
								)
									updates.shift();
							}
						}).pipe(
							Effect.catchAll((error) =>
								Effect.gen(function* () {
									disconnected = true;
									yield* Deferred.fail(ready, error);
									if (generation === epoch) {
										active = undefined;
										updates = [];
										reconnectAt = (yield* Clock.currentTimeMillis) + 500;
									}
									controller.abort();
									yield* socket.close;
								}),
							),
							(effect) => Effect.forkIn(effect, scope),
						);
						yield* sendEvent(socket, {
							type: "session.update",
							event_id: crypto.randomUUID(),
							session: {
								modalities: ["text"],
								// LiveTranslate client events document pcm at 8/16 kHz.
								input_audio_format: "pcm",
								sample_rate: 16000,
								input_audio_transcription: { language: "auto" },
								translation: { language: config.targetLanguage },
								output_audio: false,
							},
						}).pipe(
							Effect.zipRight(Deferred.await(ready)),
							Effect.mapError((cause) => meetingError("Unavailable", cause)),
							Effect.timeoutFail({
								duration: 10000,
								onTimeout: () => meetingError("Timeout"),
							}),
							Effect.onError(() =>
								Effect.sync(() => controller.abort()).pipe(
									Effect.zipRight(socket.close),
									Effect.zipRight(Fiber.interrupt(reader)),
								),
							),
						);
						if (epoch !== generation || disconnected) {
							controller.abort();
							yield* socket.close;
							yield* Fiber.interrupt(reader);
							return yield* meetingError("Unavailable");
						}
						connecting = undefined;
						active = { config: identity, socket, controller, reader };
					}),
				),
		);
		const translate = Effect.fn("MeetingTranslation.push")(
			(config: MeetingConfig, pcm: Uint8Array) =>
				Effect.suspend(() => {
					if (pcm.length !== 14400 || queued >= 8)
						return Effect.fail(meetingError("Invalid"));
					queued++;
					const epoch = generation;
					return Effect.gen(function* () {
						if (generation !== epoch) return yield* meetingError("Unavailable");
						yield* prepare(config, epoch);
						yield* resolve(config, true);
						if (epoch !== generation || !active)
							return yield* meetingError("Unavailable");
						// Capture owns 300 ms at 24 kHz. Each aligned block maps exactly
						// to 4800 signed samples at the provider's documented 16 kHz.
						const audio = pcmResampler(24000, 16000)(pcm);
						if (audio.length !== 9600) return yield* meetingError("Invalid");
						yield* sendEvent(active.socket, {
							type: "input_audio_buffer.append",
							audio: encodeAudio(audio),
						}).pipe(
							Effect.mapError((cause) => meetingError("Unavailable", cause)),
							Effect.timeoutFail({
								duration: 5000,
								onTimeout: () => meetingError("Timeout"),
							}),
						);
						if (epoch !== generation) return yield* meetingError("Unavailable");
						const result = updates;
						updates = [];
						return result;
					}).pipe(
						Effect.ensuring(
							Effect.sync(() => {
								queued--;
							}),
						),
					);
				}),
		);
		return { prepareTranslation: prepare, translate, stopTranslation: stop };
	},
);
