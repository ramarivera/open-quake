import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Queue, Stream } from "effect";
import {
	AiAuthRequired,
	AiUnavailable,
} from "../../../../../packages/edge/src/ai/ai-errors";
import { AiSpeechService } from "../../../../../packages/edge/src/ai/speech/speech-service";
import { sttProfile } from "../../../../../packages/edge/src/ai/speech/speech-test-fixtures";
import {
	VoiceSurface,
	VoiceSurfacePublisher,
	VoiceTonePort,
} from "../../../../../packages/edge/src/voice/surface";
import type { VoiceSurfaceEvent } from "../../shared/voice-surface";
import { DesktopSpeechError } from "./errors";
import { createProductionVoiceRuntime } from "./runtime";

for (const [text, audio, expected] of [
	["我", true, "我"],
	["OK", true, "OK"],
	["7", true, "7"],
	["。!?", true, "unclear"],
	[" \n", true, "unclear"],
	["", false, "noAudio"],
] as const) {
	it.scoped(
		`AI-084/086: final ${JSON.stringify(text)} with audio=${audio} yields ${expected}`,
		() =>
			Effect.gen(function* () {
				const events = yield* Queue.unbounded<VoiceSurfaceEvent>();
				const sent: string[] = [];
				let pulls = 0,
					closes = 0;
				yield* Effect.gen(function* () {
					const base = yield* AiSpeechService;
					const speech = AiSpeechService.make({
						...base,
						recognize: (_profile, frames) =>
							Stream.runDrain(frames).pipe(Effect.as(text)),
					});
					const c = yield* createProductionVoiceRuntime({
						speech,
						profiles: () =>
							Effect.succeed({ speakAnswers: false, stt: sttProfile }),
						capture: {
							permission: Effect.succeed(true),
							open: (captureId) =>
								Effect.succeed({
									pull: Effect.sync(() => ({
										frames:
											audio && pulls++ === 0
												? [
														{
															captureId,
															seq: 0,
															bytes: new Uint8Array(960),
															rms: 0.1,
															peak: 0.1,
														},
													]
												: [],
										done: true,
									})),
									stop: Effect.void,
									close: Effect.sync(() => {
										closes++;
									}),
								}),
						},
						sendText: () => Effect.void,
						sendTranscript: (request) =>
							Effect.sync(() => {
								expect(closes).toBe(1);
								sent.push(request.message);
							}),
					});
					yield* c.runtime.startCapture({
						serial: "QK",
						keyCode: "1,5",
						captureId: "fake",
						generation: 1,
						type: "aiChat",
						agentId: Option.none(),
					});
					let terminal: VoiceSurfaceEvent;
					do {
						terminal = yield* Queue.take(events);
					} while (terminal._tag !== "Stage" || terminal.stage._tag !== "idle");
					yield* Effect.yieldNow().pipe(Effect.repeatN(10));
					if (expected === "unclear" || expected === "noAudio") {
						expect(terminal.stage).toEqual({
							_tag: "idle",
							outcome: "empty",
							emptyReason: expected,
						});
						expect(sent).toEqual([]);
					} else {
						expect(sent).toEqual([expected]);
						expect(terminal.stage).toEqual({
							_tag: "idle",
							outcome: "completed",
						});
					}
				}).pipe(
					Effect.provide(
						Layer.mergeAll(
							AiSpeechService.Default,
							VoiceSurface.Default.pipe(
								Layer.provide(
									Layer.mergeAll(
										Layer.succeed(VoiceSurfacePublisher, {
											publish: (event) =>
												Queue.offer(events, event).pipe(Effect.asVoid),
										}),
										Layer.succeed(VoiceTonePort, { play: () => Effect.void }),
									),
								),
							),
						),
					),
				);
			}),
	);
}
for (const [failure, expectedReason] of [
	[new DesktopSpeechError("NoDevice", "recorder"), "noMic"],
	[new DesktopSpeechError("PermissionDenied", "permission"), "noMic"],
	[new DesktopSpeechError("RecorderUnavailable", "recorder"), "noMic"],
	[new AiAuthRequired(), "server"],
	[new DesktopSpeechError("PhaseTimeout", "session"), "server"],
] as const)
	it.scoped(
		`AI-086: typed ${failure.code} maps to ${expectedReason} with stable code`,
		() =>
			Effect.gen(function* () {
				const events = yield* Queue.unbounded<VoiceSurfaceEvent>();
				yield* Effect.gen(function* () {
					const base = yield* AiSpeechService;
					const c = yield* createProductionVoiceRuntime({
						speech: AiSpeechService.make({
							...base,
							recognize: () =>
								Effect.fail(
									failure instanceof DesktopSpeechError
										? new AiUnavailable(failure)
										: failure,
								),
						}),
						profiles: () =>
							Effect.succeed({ speakAnswers: false, stt: sttProfile }),
						capture: {
							permission: Effect.succeed(true),
							open: () =>
								Effect.die("fake recognition must not acquire capture"),
						},
						sendText: () => Effect.void,
						sendTranscript: () => Effect.die("failure must not chat"),
					});
					yield* c.runtime.startCapture({
						serial: "QK",
						keyCode: "1,5",
						captureId: "fake",
						generation: 1,
						type: "aiChat",
						agentId: Option.none(),
					});
					let terminal: VoiceSurfaceEvent;
					do {
						terminal = yield* Queue.take(events);
					} while (
						terminal._tag !== "Stage" ||
						terminal.stage._tag !== "failed"
					);
					expect(terminal.stage).toMatchObject({
						_tag: "failed",
						reason: expectedReason,
						errorCode: failure.code,
					});
				}).pipe(
					Effect.provide(
						Layer.mergeAll(
							AiSpeechService.Default,
							VoiceSurface.Default.pipe(
								Layer.provide(
									Layer.mergeAll(
										Layer.succeed(VoiceSurfacePublisher, {
											publish: (event) =>
												Queue.offer(events, event).pipe(Effect.asVoid),
										}),
										Layer.succeed(VoiceTonePort, { play: () => Effect.void }),
									),
								),
							),
						),
					),
				);
			}),
	);
