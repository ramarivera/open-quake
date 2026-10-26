import { expect, it } from "@effect/vitest";
import {
	Clock,
	Effect,
	Layer,
	Option,
	Queue,
	Redacted,
	Schema,
	TestClock,
} from "effect";
import { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import { SpeechWebSocket } from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { AiSpeechService } from "../../../../../packages/edge/src/ai/speech/speech-service";
import { sttProfile } from "../../../../../packages/edge/src/ai/speech/speech-test-fixtures";
import {
	VoiceSurface,
	VoiceSurfacePublisher,
	VoiceTonePort,
} from "../../../../../packages/edge/src/voice/surface";
import {
	initialVoiceView,
	reduceVoice,
} from "../../renderer/src/strip/overlays/voice/voice-state";
import type { VoiceSurfaceEvent } from "../../shared/voice-surface";
import { createProductionVoiceRuntime } from "./runtime";

it.effect(
	"real capture-to-strip meter uses RMS/peak, exact 50/180 ms throttle, 15-buffer VAD and fresh capture state",
	() =>
		Effect.scoped(
			Effect.gen(function* () {
				const input = yield* Queue.unbounded<{ rms: number; peak: number }>();
				const sent = yield* Queue.unbounded<void>();
				const packets = yield* Queue.unbounded<unknown>();
				const levels: {
					at: number;
					rms: number;
					speaking: boolean;
					captureId: string;
				}[] = [];
				const stages: string[] = [];
				let view = initialVoiceView;
				let closes = 0;
				const layer = Layer.mergeAll(
					VoiceSurface.Default.pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(VoiceTonePort, { play: () => Effect.void }),
								Layer.succeed(VoiceSurfacePublisher, {
									publish: (event: VoiceSurfaceEvent) =>
										Effect.gen(function* () {
											view = reduceVoice(
												view,
												{ _tag: "event", event },
												new Map(),
												yield* Clock.currentTimeMillis,
											);
											if (event._tag === "Level")
												levels.push({
													at: yield* Clock.currentTimeMillis,
													...event,
												});
											if (
												event._tag === "Stage" &&
												event.stage._tag === "recording"
											)
												stages.push(event.stage.status);
										}),
								}),
							),
						),
					),
					AiSpeechService.Default.pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(AiCredentials, {
									resolve: () => Effect.succeed(Redacted.make("fake")),
									revoked: () => Effect.never,
								}),
								Layer.succeed(SpeechWebSocket, {
									connect: () =>
										Effect.succeed({
											receive: Queue.take(packets),
											close: Effect.void,
											send: (data) =>
												typeof data === "string"
													? Effect.gen(function* () {
															const command = Schema.decodeUnknownSync(
																Schema.parseJson(
																	Schema.Struct({
																		header: Schema.Struct({
																			task_id: Schema.String,
																		}),
																	}),
																),
															)(data);
															yield* Queue.offer(packets, {
																header: {
																	event: "task-started",
																	task_id: command.header.task_id,
																},
															});
														})
													: Queue.offer(sent, undefined).pipe(Effect.asVoid),
										}),
								}),
							),
						),
					),
				);
				yield* Effect.gen(function* () {
					const controller = yield* createProductionVoiceRuntime({
						speech: yield* AiSpeechService,
						profiles: () =>
							Effect.succeed({ stt: sttProfile, speakAnswers: false }),
						sendText: () => Effect.void,
						sendTranscript: () => Effect.die("no transcript"),
						capture: {
							permission: Effect.succeed(true),
							open: (captureId) =>
								Effect.sync(() => {
									let seq = 0;
									return {
										pull: Queue.take(input).pipe(
											Effect.map((level) => ({
												frames: [
													{
														captureId,
														seq: seq++,
														bytes: new Uint8Array(960),
														...level,
													},
												],
												done: false,
											})),
										),
										stop: Effect.void,
										close: Effect.sync(() => {
											closes++;
										}),
									};
								}),
						},
					});
					const request = {
						serial: "fake",
						keyCode: "0,1",
						captureId: "one",
						generation: 1,
						type: "aiChat" as const,
						agentId: Option.none<string>(),
					};
					const frame = (rms: number, peak: number) =>
						Queue.offer(input, { rms, peak }).pipe(
							Effect.zipRight(Queue.take(sent)),
						);
					yield* controller.runtime.startCapture(request);
					yield* frame(0.01, 0.8);
					expect(view.bar.rms).toBeCloseTo(0.035);
					expect(view.bar.speaking).toBe(true);
					expect(stages).toEqual(["preparing", "listening", "speaking"]);
					yield* TestClock.adjust(49);
					yield* frame(0.2, 0.4);
					expect(levels).toHaveLength(1);
					yield* TestClock.adjust(1);
					yield* frame(0.2, 0.4);
					expect(view.bar.rms).toBeCloseTo(0.7);
					expect(levels.map((e) => e.at)).toEqual([0, 50]);
					for (let i = 0; i < 14; i++) yield* frame(0.01, 0.02);
					expect(stages.at(-1)).toBe("speaking");
					expect(closes).toBe(0);
					yield* frame(0.01, 0.02);
					expect(stages.at(-1)).toBe("listening");
					yield* TestClock.adjust(179);
					yield* frame(0.01, 0.02);
					expect(levels).toHaveLength(2);
					yield* TestClock.adjust(1);
					yield* frame(0.01, 0.02);
					expect(levels.map((e) => e.at)).toEqual([0, 50, 230]);
					expect(view.bar.rms).toBeCloseTo(0.01225);
					expect(view.bar.speaking).toBe(false);
					yield* TestClock.adjust(50);
					yield* frame(1, 1);
					expect(view.bar.rms).toBe(1);
					yield* controller.runtime.cancelCapture("fake", "0,1", 1);
					expect(closes).toBe(1);
					yield* controller.runtime.startCapture({
						...request,
						captureId: "two",
						generation: 2,
					});
					yield* frame(0.01, 0.02);
					expect(levels.at(-1)).toMatchObject({
						at: 280,
						captureId: "two",
						speaking: false,
					});
					expect(stages.slice(-2)).toEqual(["preparing", "listening"]);
					yield* controller.runtime.cancelCapture("fake", "0,1", 2);
				}).pipe(Effect.provide(layer));
			}),
		),
);
