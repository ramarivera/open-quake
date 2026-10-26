import { expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Layer,
	Option,
	Queue,
	Redacted,
	Schema,
	TestClock,
} from "effect";
import { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import {
	SpeechHttp,
	SpeechOutput,
	type SpeechOutputTarget,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { AiSpeechService } from "../../../../../packages/edge/src/ai/speech/speech-service";
import {
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
import type {
	ReaderSettings,
	VoiceSurfaceEvent,
} from "../../shared/voice-surface";

const sessionId = Schema.decodeUnknownSync(SessionId)(
	"00000000-0000-4000-8000-000000000021",
);
const turnId = Schema.decodeUnknownSync(TurnId)(
	"00000000-0000-4000-8000-000000000022",
);
const started = (): Extract<VoiceSurfaceEvent, { _tag: "TurnStarted" }> => ({
	_tag: "TurnStarted",
	serial: "QK",
	keyCode: "1,5",
	sessionId,
	turnId,
	prompt: "fake",
	source: "typed",
});
const delta = (
	textDelta: string,
	seq: number,
): Extract<VoiceSurfaceEvent, { _tag: "Chunk" }> => ({
	_tag: "Chunk",
	serial: "QK",
	keyCode: "1,5",
	chunk: { version: 1, sessionId, turnId, seq, type: "answer", textDelta },
});

import { createProductionVoiceRuntime } from "./runtime";
import { SPOKEN_STATUS, spokenStatus } from "./status-phrases";

const settings: ReaderSettings = {
	engine: "qwen",
	rate: 1,
	pitch: 1,
	volume: 1,
	voiceHint: "",
};
const tick = Effect.yieldNow().pipe(Effect.repeatN(10));
const surface = (events: VoiceSurfaceEvent[]) =>
	VoiceSurface.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(VoiceSurfacePublisher, {
					publish: (event) =>
						Effect.sync(() => {
							events.push(event);
						}),
				}),
				Layer.succeed(VoiceTonePort, { play: () => Effect.void }),
			),
		),
	);

it.scoped(
	"KNOB-073 WIDGETS-015/108 AI-091: reader toggles actual ordered same-device answer speech with truthful phases and teardown",
	() =>
		Effect.gen(function* () {
			const events: VoiceSurfaceEvent[] = [],
				texts: string[] = [],
				targets: SpeechOutputTarget[] = [];
			const playing = yield* Queue.unbounded<void>();
			const drain = yield* Queue.unbounded<void>();
			let stops = 0;
			const layer = Layer.mergeAll(
				surface(events),
				AiSpeechService.Default.pipe(
					Layer.provide(
						Layer.mergeAll(
							Layer.succeed(AiCredentials, {
								resolve: () => Effect.succeed(Redacted.make("fake")),
								revoked: () => Effect.never,
							}),
							Layer.succeed(SpeechHttp, {
								fetch: async (_url, init) => {
									const input = Schema.decodeUnknownSync(
										Schema.parseJson(Schema.Struct({ input: Schema.String })),
									)(String(init.body));
									texts.push(input.input);
									return new Response(wav(), {
										headers: { "Content-Type": "audio/wav" },
									});
								},
							}),
							Layer.succeed(SpeechOutput, {
								suspendForCapture: Effect.void,
								acquire: Effect.die("implicit target"),
								acquireFor: (target) =>
									Effect.sync(() => {
										targets.push(target);
										return {
											ready: Effect.void,
											play: () =>
												Queue.offer(playing, undefined).pipe(
													Effect.zipRight(Queue.take(drain)),
												),
											stop: Effect.sync(() => {
												stops++;
											}),
										};
									}),
							}),
						),
					),
				),
			);
			yield* Effect.gen(function* () {
				const c = yield* createProductionVoiceRuntime({
					speech: yield* AiSpeechService,
					capture: {
						permission: Effect.succeed(false),
						open: () => Effect.never,
					},
					profiles: () =>
						Effect.succeed({ speakAnswers: false, tts: ttsProfile }),
					sendText: () => Effect.void,
					sendTranscript: () => Effect.void,
				});
				yield* c.toggleReader({ serial: "QK", keyCode: "1,9" }, settings);
				yield* c.observe({ ...started(), serial: "foreign" });
				yield* c.observe({ ...delta("Foreign.", 0), serial: "foreign" });
				yield* tick;
				expect(texts).toEqual([]);
				yield* c.observe(started());
				yield* c.observe(delta("First. Second.", 0));
				yield* Queue.take(playing);
				expect(texts).toEqual(["First."]);
				expect(
					events.filter((e) => e._tag === "ReadAloudState").at(-1),
				).toMatchObject({ keyCode: "1,9", phase: "speaking" });
				yield* Queue.offer(drain, undefined);
				yield* Queue.take(playing);
				expect(texts).toEqual(["First.", " Second."]);
				expect(targets).toEqual(
					Array(2).fill({ kind: "device", serial: "QK", keyCode: "1,9" }),
				);
				yield* c.toggleReader({ serial: "QK", keyCode: "1,9" }, settings);
				yield* c.observe(delta("Late.", 1));
				yield* TestClock.adjust(5000);
				expect(texts).toHaveLength(2);
				expect(stops).toBe(2);
				expect(
					events.filter((e) => e._tag === "ReadAloudState").at(-1),
				).toMatchObject({ phase: "idle" });
			}).pipe(Effect.provide(layer));
		}),
);

it.scoped(
	"MGMT-301: local reader bypasses absent cloud profiles and reset cancels exactly its queue",
	() =>
		Effect.gen(function* () {
			const events: VoiceSurfaceEvent[] = [],
				calls: string[] = [];
			const entered = yield* Deferred.make<void>();
			let cancelled = 0;
			yield* Effect.gen(function* () {
				const original = yield* AiSpeechService;
				const c = yield* createProductionVoiceRuntime({
					speech: original,
					localSpeech: (value, owner) => {
						expect(value.engine).toBe("webSpeech");
						expect(owner.keyCode).toBe("1,9");
						return {
							createSpeech: (_profile, text, phase) =>
								Effect.succeed({
									cancel: () =>
										Effect.sync(() => {
											cancelled++;
										}),
									result: Effect.sync(() => {
										calls.push(text);
									}).pipe(
										Effect.zipRight(phase?.("speaking") ?? Effect.void),
										Effect.zipRight(Deferred.succeed(entered, undefined)),
										Effect.zipRight(Effect.never),
									),
								}),
						};
					},
					capture: {
						permission: Effect.succeed(false),
						open: () => Effect.never,
					},
					profiles: () => Effect.succeed({ speakAnswers: false }),
					sendText: () => Effect.void,
					sendTranscript: () => Effect.void,
				});
				yield* c.toggleReader(
					{ serial: "QK", keyCode: "1,9" },
					{ ...settings, engine: "webSpeech" },
				);
				yield* c.observe(started());
				yield* c.observe(delta("Local.", 0));
				yield* Deferred.await(entered);
				yield* c.observe({
					_tag: "Reset",
					serial: "QK",
					reason: "profileChanged",
				});
				expect(calls).toEqual(["Local."]);
				expect(cancelled).toBe(1);
			}).pipe(
				Effect.provide(
					Layer.mergeAll(surface(events), AiSpeechService.Default),
				),
			);
		}),
);

for (const locale of ["en", "zh", "de", "es", "fr", "it", "ja", "ko"] as const)
	it.scoped(
		`AI-080: ${locale} completion speaks once through the real turn queue`,
		() =>
			Effect.gen(function* () {
				const events: VoiceSurfaceEvent[] = [],
					texts: string[] = [];
				yield* Effect.gen(function* () {
					const base = yield* AiSpeechService;
					const c = yield* createProductionVoiceRuntime({
						speech: AiSpeechService.make({
							...base,
							createSpeech: (_profile, text) =>
								Effect.succeed({
									cancel: () => Effect.void,
									result: Effect.sync(() => {
										texts.push(text);
										return { _tag: "completed" } as const;
									}),
								}),
						}),
						capture: {
							permission: Effect.succeed(false),
							open: () => Effect.never,
						},
						profiles: () =>
							Effect.succeed({
								tts: { ...ttsProfile, language: locale },
								speakAnswers: true,
							}),
						sendText: () => Effect.void,
						sendTranscript: () => Effect.void,
					});
					yield* c.observe(started());
					yield* c.observe(delta("Answer.", 0));
					const end: VoiceSurfaceEvent = {
						_tag: "Chunk",
						serial: "QK",
						keyCode: "1,5",
						chunk: {
							version: 1,
							sessionId,
							turnId,
							seq: 1,
							type: "end",
							outcome: "completed",
						},
					};
					yield* c.observe(end);
					yield* c.observe(end);
					yield* tick;
					expect(texts).toEqual([
						"Answer.",
						SPOKEN_STATUS[locale].finishedOutput,
					]);
					expect(spokenStatus(`${locale}-XX`, "finishedOutput")).toBe(
						SPOKEN_STATUS[locale].finishedOutput,
					);
					expect(spokenStatus("unknown", "finishedOutput")).toBe("Finished");
				}).pipe(
					Effect.provide(
						Layer.mergeAll(surface(events), AiSpeechService.Default),
					),
				);
			}),
	);

for (const action of ["interrupt", "selection", "cancel-all"] as const)
	it.scoped(
		`AudioBot ${action} cancels its queue and returns the armed reader to thinking`,
		() =>
			Effect.gen(function* () {
				const events: VoiceSurfaceEvent[] = [];
				const entered = yield* Queue.unbounded<void>();
				const texts: string[] = [];
				let stops = 0;
				yield* Effect.gen(function* () {
					const c = yield* createProductionVoiceRuntime({
						speech: yield* AiSpeechService,
						localSpeech: () => ({
							createSpeech: (_profile, text, phase) =>
								Effect.succeed({
									cancel: () =>
										Effect.sync(() => {
											stops++;
										}),
									result: Effect.sync(() => {
										texts.push(text);
									}).pipe(
										Effect.zipRight(phase?.("speaking") ?? Effect.void),
										Effect.zipRight(Queue.offer(entered, undefined)),
										Effect.zipRight(Effect.never),
									),
								}),
						}),
						capture: {
							permission: Effect.succeed(false),
							open: () => Effect.never,
						},
						profiles: () => Effect.succeed({ speakAnswers: false }),
						sendText: () => Effect.void,
						sendTranscript: () => Effect.void,
					});
					yield* c.toggleReader(
						{ serial: "QK", keyCode: "1,9" },
						{ ...settings, engine: "webSpeech" },
					);
					yield* c.observe(started());
					yield* c.observe(delta("First.", 0));
					yield* Queue.take(entered);
					const speaking = events
						.filter((e) => e._tag === "ReadAloudState")
						.at(-1);
					expect(speaking).toMatchObject({ keyCode: "1,9", phase: "speaking" });
					yield* c.runtime.cancelFlow("foreign", "1,5");
					expect(stops).toBe(0);
					yield* action === "interrupt"
						? c.runtime.cancelFlow("QK", "1,5")
						: action === "selection"
							? c.runtime.select("QK", "1,6", "aiChat", Option.none())
							: c.cancelSpeech();
					expect(stops).toBe(1);
					expect(
						events.filter((e) => e._tag === "ReadAloudState").at(-1),
					).toEqual({ ...speaking, phase: "thinking" });
					yield* c.observe(delta("Stale.", 1));
					yield* tick;
					expect(texts).toEqual(["First."]);
					yield* c.observe(started());
					yield* c.observe(delta("Next.", 0));
					yield* Queue.take(entered);
					expect(texts).toEqual(["First.", "Next."]);
					expect(
						events.filter((e) => e._tag === "ReadAloudState").at(-1),
					).toEqual(speaking);
				}).pipe(
					Effect.provide(
						Layer.mergeAll(surface(events), AiSpeechService.Default),
					),
				);
			}),
	);
