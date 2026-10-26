import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Fiber,
	Layer,
	Option,
	Queue,
	Redacted,
	Schema,
} from "effect";
import { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import {
	SpeechHttp,
	SpeechOutput,
	SpeechWebSocket,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { AiSpeechService } from "../../../../../packages/edge/src/ai/speech/speech-service";
import {
	sttProfile,
	ttsProfile,
	wav,
} from "../../../../../packages/edge/src/ai/speech/speech-test-fixtures";
import {
	SessionId,
	TurnId,
} from "../../../../../packages/edge/src/chat/chat-contracts";
import {
	VoiceSurface,
	VoiceSurfacePublisher,
	VoiceTonePort,
} from "../../../../../packages/edge/src/voice/surface";
import type { CaptureRequest } from "../../../../../packages/edge/src/voice/surface/voice-surface-ports";
import type { VoiceSurfaceEvent } from "../../shared/voice-surface";
import type { CaptureDriver } from "./capture";
import { createProductionVoiceRuntime } from "./runtime";

const request: CaptureRequest = {
	serial: "QK-1",
	keyCode: "1,5",
	captureId: "capture/one",
	generation: 1,
	type: "aiChat",
	agentId: Option.some("agent"),
};
const Command = Schema.parseJson(
	Schema.Struct({
		header: Schema.Struct({ action: Schema.String, task_id: Schema.String }),
	}),
);
const decode = Schema.decodeUnknownSync(Command);
const event = (task: string, type: string, payload: unknown = {}) => ({
	header: { task_id: task, event: type },
	payload,
});
const surfaceLayer = (
	events: VoiceSurfaceEvent[],
	onEvent: (event: VoiceSurfaceEvent) => Effect.Effect<void> = () =>
		Effect.void,
) =>
	VoiceSurface.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(VoiceSurfacePublisher, {
					publish: (event) =>
						Effect.sync(() => events.push(event)).pipe(
							Effect.zipRight(onEvent(event)),
						),
				}),
				Layer.succeed(VoiceTonePort, { play: () => Effect.void }),
			),
		),
	);
const credentials = Layer.succeed(AiCredentials, {
	resolve: () => Effect.succeed(Redacted.make("synthetic-key")),
	revoked: () => Effect.never,
});
const tick = Effect.yieldNow().pipe(Effect.repeatN(10));

describe("production voice consumer", () => {
	it.effect(
		"uses actual STT after matching readiness, sends final transcript only after physical recorder/socket finalization, ignores stale release",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const events: VoiceSurfaceEvent[] = [];
					const messages = yield* Queue.unbounded<unknown>();
					const configured = yield* Deferred.make<string>();
					const listening = yield* Deferred.make<void>();
					const stop = yield* Deferred.make<void>();
					const transcript = yield* Deferred.make<string>();
					const calls: string[] = [];
					let opened = 0,
						closed = 0,
						socketClosed = 0,
						pulls = 0;
					const capture: CaptureDriver = {
						permission: Effect.succeed(true),
						open: (id) =>
							Effect.sync(() => {
								opened++;
								return {
									pull: Effect.suspend<
										Effect.Effect.Success<
											import("./capture").CaptureSession["pull"]
										>,
										never,
										never
									>(() =>
										pulls++ === 0
											? Effect.succeed({
													frames: [
														{
															captureId: id,
															seq: 0,
															bytes: new Uint8Array(960),
															rms: 0.5,
															peak: 0.5,
														},
													],
													done: false,
												})
											: Deferred.await(stop).pipe(
													Effect.as({ frames: [], done: true }),
												),
									),
									stop: Deferred.succeed(stop, undefined).pipe(Effect.asVoid),
									close: Effect.sync(() => {
										closed++;
									}),
								};
							}),
					};
					const ws: typeof SpeechWebSocket.Service = {
						connect: (input) =>
							Effect.sync(() => {
								expect(input.headers.Authorization).toBe(
									"Bearer synthetic-key",
								);
								return {
									receive: Queue.take(messages),
									close: Effect.sync(() => {
										socketClosed++;
									}),
									send: (data) =>
										Effect.gen(function* () {
											if (typeof data !== "string") {
												calls.push("pcm");
												return;
											}
											const command = decode(data);
											calls.push(command.header.action);
											if (command.header.action === "run-task")
												yield* Deferred.succeed(
													configured,
													command.header.task_id,
												);
											else
												yield* Queue.offerAll(messages, [
													event(command.header.task_id, "result-generated", {
														output: {
															sentence: {
																text: "Turn left",
																begin_time: 0,
																sentence_end: true,
															},
														},
													}),
													event(command.header.task_id, "task-finished"),
												]);
										}),
								};
							}),
					};
					const layer = Layer.mergeAll(
						surfaceLayer(events, (event) =>
							event._tag === "Stage" &&
							event.stage._tag === "recording" &&
							event.stage.status === "listening"
								? Deferred.succeed(listening, undefined).pipe(Effect.asVoid)
								: Effect.void,
						),
						AiSpeechService.Default.pipe(
							Layer.provide(
								Layer.mergeAll(credentials, Layer.succeed(SpeechWebSocket, ws)),
							),
						),
					);
					yield* Effect.gen(function* () {
						const speech = yield* AiSpeechService;
						const controller = yield* createProductionVoiceRuntime({
							speech,
							capture,
							profiles: () =>
								Effect.succeed({ stt: sttProfile, speakAnswers: false }),
							sendText: () => Effect.die("old unavailable path"),
							sendTranscript: (input) =>
								Effect.gen(function* () {
									expect(closed).toBe(1);
									expect(socketClosed).toBe(1);
									yield* Deferred.succeed(transcript, input.message);
								}),
						});
						yield* controller.runtime.startCapture(request);
						const task = yield* Deferred.await(configured);
						expect(opened).toBe(0);
						yield* Queue.offer(messages, event(task, "task-started"));
						yield* Deferred.await(listening);
						yield* controller.runtime.releaseCapture(
							request.serial,
							request.keyCode,
							0,
						);
						expect(yield* Deferred.isDone(stop)).toBe(false);
						yield* controller.runtime.releaseCapture(
							request.serial,
							request.keyCode,
							1,
						);
						expect(yield* Deferred.await(transcript)).toBe("Turn left");
						expect(calls).toEqual(["run-task", "pcm", "finish-task"]);
						expect(
							events.some(
								(event) =>
									event._tag === "Stage" && event.stage._tag === "failed",
							),
						).toBe(false);
					}).pipe(Effect.provide(layer));
				}),
			),
	);
	it.effect(
		"release before permission completes never opens recorder or provider and emits one cancelled terminal",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const permission = yield* Deferred.make<boolean>();
					const entered = yield* Deferred.make<void>();
					const events: VoiceSurfaceEvent[] = [];
					let opened = 0,
						sent = 0;
					yield* Effect.gen(function* () {
						const speech = yield* AiSpeechService;
						const controller = yield* createProductionVoiceRuntime({
							speech,
							profiles: () =>
								Effect.succeed({ stt: sttProfile, speakAnswers: false }),
							capture: {
								permission: Deferred.succeed(entered, undefined).pipe(
									Effect.zipRight(Deferred.await(permission)),
								),
								open: () => {
									opened++;
									return Effect.never;
								},
							},
							sendTranscript: () =>
								Effect.sync(() => {
									sent++;
								}),
							sendText: () => Effect.void,
						});
						yield* controller.runtime.startCapture(request);
						yield* Deferred.await(entered);
						yield* controller.runtime.releaseCapture(
							request.serial,
							request.keyCode,
							1,
						);
						yield* Deferred.succeed(permission, true);
						yield* tick;
						expect(opened).toBe(0);
						expect(sent).toBe(0);
						expect(
							events.filter(
								(event) =>
									event._tag === "Stage" && event.stage._tag === "idle",
							),
						).toHaveLength(1);
					}).pipe(
						Effect.provide(
							Layer.mergeAll(surfaceLayer(events), AiSpeechService.Default),
						),
					);
				}),
			),
	);
	it.effect(
		"Read Aloud and actual answer chunks use one configured TTS service and wait for drain, followUps never speak",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const httpTexts: string[] = [];
					const played = yield* Queue.unbounded<void>();
					const drained = yield* Queue.unbounded<void>();
					const reports: string[] = [];
					const layer = Layer.mergeAll(
						surfaceLayer([]),
						AiSpeechService.Default.pipe(
							Layer.provide(
								Layer.mergeAll(
									credentials,
									Layer.succeed(SpeechHttp, {
										fetch: async (_url, init) => {
											const body = Schema.decodeUnknownSync(
												Schema.parseJson(
													Schema.Struct({ input: Schema.String }),
												),
											)(String(init.body));
											httpTexts.push(body.input);
											return new Response(wav(), {
												headers: { "Content-Type": "audio/wav" },
											});
										},
									}),
									Layer.succeed(SpeechOutput, {
										suspendForCapture: Effect.void,
										acquire: Effect.succeed({
											ready: Effect.void,
											play: () =>
												Queue.offer(played, undefined).pipe(
													Effect.zipRight(Queue.take(drained)),
												),
											stop: Effect.void,
										}),
									}),
								),
							),
						),
					);
					yield* Effect.gen(function* () {
						const controller = yield* createProductionVoiceRuntime({
							speech: yield* AiSpeechService,
							capture: {
								permission: Effect.succeed(true),
								open: () => Effect.never,
							},
							profiles: () =>
								Effect.succeed({ tts: ttsProfile, speakAnswers: true }),
							sendTranscript: () => Effect.void,
							sendText: () => Effect.void,
							speechError: (code) => Effect.sync(() => reports.push(code)),
						});
						const sessionId = Schema.decodeUnknownSync(SessionId)(
							crypto.randomUUID(),
						);
						const turnId = Schema.decodeUnknownSync(TurnId)(
							crypto.randomUUID(),
						);
						yield* controller.observe({
							_tag: "TurnStarted",
							serial: "QK",
							keyCode: "1,5",
							sessionId,
							turnId,
							prompt: "input",
							source: "typed",
						});
						yield* controller.observe({
							_tag: "Chunk",
							serial: "QK",
							keyCode: "1,5",
							chunk: {
								version: 1,
								sessionId,
								turnId,
								seq: 0,
								type: "answer",
								textDelta: "First. Second",
							},
						});
						yield* Queue.take(played);
						expect(httpTexts).toEqual(["First."]);
						yield* controller.observe({
							_tag: "Chunk",
							serial: "QK",
							keyCode: "1,5",
							chunk: {
								version: 1,
								sessionId,
								turnId,
								seq: 1,
								type: "followUp",
								suggestionId: "follow-one",
								text: "Do not speak",
							},
						});
						yield* controller.observe({
							_tag: "Chunk",
							serial: "QK",
							keyCode: "1,5",
							chunk: {
								version: 1,
								sessionId,
								turnId,
								seq: 2,
								type: "end",
								outcome: "completed",
							},
						});
						yield* Queue.offer(drained, undefined);
						yield* Queue.take(played);
						expect(httpTexts).toEqual(["First.", " Second"]);
						yield* Queue.offer(drained, undefined);
						yield* Queue.take(played);
						expect(httpTexts).toEqual(["First.", " Second", "Fertig"]);
						yield* Queue.offer(drained, undefined);
						yield* tick;
						const reader = yield* controller
							.readAloud("Read this")
							.pipe(Effect.fork);
						yield* Queue.take(played);
						expect(Option.isNone(yield* Fiber.poll(reader))).toBe(true);
						yield* Queue.offer(drained, undefined);
						expect(yield* Fiber.join(reader)).toEqual({ _tag: "completed" });
						expect(httpTexts).toEqual([
							"First.",
							" Second",
							"Fertig",
							"Read this",
						]);
						expect(reports).toEqual([]);
					}).pipe(Effect.provide(layer));
				}),
			),
	);
	it.effect(
		"missing speech profile stays unavailable without inferring a chat provider",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					yield* Effect.gen(function* () {
						const controller = yield* createProductionVoiceRuntime({
							speech: yield* AiSpeechService,
							capture: {
								permission: Effect.die("must not prompt"),
								open: () => Effect.die("must not record"),
							},
							profiles: () => Effect.succeed({ speakAnswers: true }),
							sendText: () => Effect.void,
							sendTranscript: () => Effect.die("must not chat"),
						});
						expect(yield* controller.readAloud("text")).toMatchObject({
							_tag: "textOnly",
							error: { code: "AI.PROVIDER.UNAVAILABLE" },
						});
					}).pipe(
						Effect.provide(
							Layer.mergeAll(surfaceLayer([]), AiSpeechService.Default),
						),
					);
				}),
			),
	);
});

it.effect(
	"cancels pending profile lookup before replacing Read Aloud and never acquires the canceled player",
	() =>
		Effect.scoped(
			Effect.gen(function* () {
				const profilesEntered = yield* Queue.unbounded<void>();
				const profilesReleased = yield* Queue.unbounded<void>();
				const acquisitions = yield* Queue.unbounded<void>();
				let live = 0,
					peak = 0,
					cancelled = 0;
				yield* Effect.gen(function* () {
					const original = yield* AiSpeechService;
					const speech = AiSpeechService.make({
						...original,
						createSpeech: () =>
							Effect.gen(function* () {
								live++;
								peak = Math.max(peak, live);
								yield* Queue.offer(acquisitions, undefined);
								const done =
									yield* Deferred.make<
										import("../../../../../packages/edge/src/ai/speech/speech-service").SpeechOutcome
									>();
								return {
									result: Deferred.await(done),
									cancel: () =>
										Effect.sync(() => {
											live--;
											cancelled++;
										}).pipe(
											Effect.zipRight(
												Deferred.succeed(done, { _tag: "cancelled" }),
											),
											Effect.asVoid,
										),
								};
							}),
					});
					const controller = yield* createProductionVoiceRuntime({
						speech,
						capture: {
							permission: Effect.succeed(false),
							open: () => Effect.never,
						},
						profiles: () =>
							Queue.offer(profilesEntered, undefined).pipe(
								Effect.zipRight(Queue.take(profilesReleased)),
								Effect.as({ speakAnswers: false, tts: ttsProfile }),
							),
						sendText: () => Effect.void,
						sendTranscript: () => Effect.void,
					});
					const first = yield* controller.readAloud("one").pipe(Effect.fork);
					yield* Queue.take(profilesEntered);
					const second = yield* controller.readAloud("two").pipe(Effect.fork);
					yield* Queue.take(profilesEntered);
					expect(yield* Fiber.join(first)).toEqual({ _tag: "cancelled" });
					yield* Queue.offer(profilesReleased, undefined);
					yield* Queue.take(acquisitions);
					expect(peak).toBe(1);
					expect(cancelled).toBe(0);
					yield* controller.cancelSpeech();
					expect(cancelled).toBe(1);
					expect(yield* Fiber.join(first)).toEqual({ _tag: "cancelled" });
					expect(yield* Fiber.join(second)).toEqual({ _tag: "cancelled" });
				}).pipe(
					Effect.provide(
						Layer.mergeAll(surfaceLayer([]), AiSpeechService.Default),
					),
				);
			}),
		),
);
