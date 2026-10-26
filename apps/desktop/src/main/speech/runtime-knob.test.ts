import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Either,
	Fiber,
	Layer,
	Option,
	Queue,
	Stream,
	TestClock,
} from "effect";
import { AiUnavailable } from "../../../../../packages/edge/src/ai/ai-errors";
import type { SpeechOutcome } from "../../../../../packages/edge/src/ai/speech/speech-service";
import { AiSpeechService } from "../../../../../packages/edge/src/ai/speech/speech-service";
import {
	sttProfile,
	ttsProfile,
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
import { VoiceKnobRejected } from "../../../../../packages/edge/src/voice/surface/voice-surface-errors";
import type {
	CaptureRequest,
	TextRequest,
} from "../../../../../packages/edge/src/voice/surface/voice-surface-ports";
import type { VoiceSurfaceEvent } from "../../shared/voice-surface";
import { profileFromModel } from "../chat/host";
import { createProductionVoiceRuntime } from "./runtime";

const profile = profileFromModel({
	id: "saved",
	provider: "local",
	model: "old/model",
	role: "none",
	baseUrl: "http://localhost:8642/v1",
	credentialRef: "00000000-0000-4000-8000-000000000001",
	maxTokens: 1024,
});
const request: CaptureRequest = {
	serial: "one",
	keyCode: "0,1",
	captureId: "knob/1",
	generation: 1,
	type: "knob",
	agentId: Option.none(),
	knob: {
		profileId: "profile",
		revision: 7,
		route: "direct",
		providerId: "saved",
		modelId: "old/model",
	},
};
const tick = Effect.yieldNow().pipe(Effect.repeatN(20));

const fixture = Effect.fn("KnobTest.fixture")(function* (
	slowCleanup = false,
	delayedPin = false,
	invalidPin = false,
) {
	const events: VoiceSurfaceEvent[] = [];
	const sent: TextRequest[] = [];
	const cancels: string[] = [];
	const opened = yield* Queue.unbounded<string>();
	const listening = yield* Queue.unbounded<void>();
	const spoken = yield* Queue.unbounded<string>();
	const cancelledSpeech: string[] = [];
	const clean = yield* Deferred.make<void>();
	const pinned = yield* Deferred.make<void>();
	const pin = yield* Deferred.make<void>();
	let permissions = 0;
	let closes = 0;
	let selected = profile;
	const speech = AiSpeechService.make({
		synthesize: () => Effect.fail(new AiUnavailable()),
		createSpeech: (_profile, text) =>
			Effect.gen(function* () {
				const result = yield* Deferred.make<SpeechOutcome>();
				yield* Queue.offer(spoken, text);
				return {
					result: Deferred.await(result),
					cancel: () =>
						Effect.gen(function* () {
							cancelledSpeech.push(text);
							yield* Deferred.succeed(result, { _tag: "cancelled" });
						}),
				};
			}),
		recognize: (_input, frames) =>
			Stream.runDrain(frames).pipe(Effect.as("final transcript")),
	});
	const layer = VoiceSurface.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(VoiceSurfacePublisher, {
					publish: (e) =>
						Effect.sync(() => {
							events.push(e);
						}).pipe(
							Effect.zipRight(
								e._tag === "Stage" &&
									e.stage._tag === "recording" &&
									e.stage.status === "listening"
									? Queue.offer(listening, undefined).pipe(Effect.asVoid)
									: Effect.void,
							),
						),
				}),
				Layer.succeed(VoiceTonePort, { play: () => Effect.void }),
			),
		),
	);
	const controller = yield* createProductionVoiceRuntime({
		speech,
		pinDirectModel: () =>
			Effect.gen(function* () {
				if (invalidPin) return yield* new VoiceKnobRejected("RouteIncomplete");
				const result = selected;
				yield* Deferred.succeed(pinned, undefined);
				if (delayedPin) yield* Deferred.await(pin);
				return { profile: result, maxTokens: 1024 };
			}),
		profiles: () =>
			Effect.succeed({ stt: sttProfile, tts: ttsProfile, speakAnswers: true }),
		capture: {
			permission: Effect.sync(() => {
				permissions++;
				return true;
			}),
			open: (id) =>
				Effect.gen(function* () {
					const stopped = yield* Deferred.make<void>();
					yield* Queue.offer(opened, id);
					return {
						pull: Deferred.await(stopped).pipe(
							Effect.as({ frames: [], done: true }),
						),
						stop: Deferred.succeed(stopped, undefined).pipe(Effect.asVoid),
						close: Effect.gen(function* () {
							if (slowCleanup) yield* Deferred.await(clean);
							closes++;
						}),
					};
				}),
		},
		sendTranscript: (r) =>
			Effect.sync(() => {
				sent.push(r);
			}),
		sendText: () => Effect.void,
		cancelText: (serial) =>
			Effect.sync(() => {
				cancels.push(serial);
			}),
	}).pipe(Effect.provide(layer));
	return {
		...controller,
		events,
		sent,
		cancels,
		opened,
		listening,
		spoken,
		cancelledSpeech,
		clean,
		pinned,
		pin,
		counts: () => ({ permissions, closes }),
		changeModel: () => {
			selected = { ...profile, modelId: "new/model" };
		},
	};
});

describe("pinned knob capture ownership", () => {
	it.scoped(
		"pins model before permission, retains route through edits, and submits one final transcript",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture();
				yield* f.runtime.startCapture(request);
				yield* Queue.take(f.opened);
				yield* Queue.take(f.listening);
				f.changeModel();
				yield* f.reconcileProfiles(["profile"]);
				yield* f.runtime.releaseCapture("one", "0,1", 1);
				yield* f.runtime.releaseCapture("one", "0,1", 1);
				yield* tick;
				expect(f.sent).toHaveLength(1);
				expect(f.sent[0]?.knob).toEqual(request.knob);
				expect(f.sent[0]?.directModel?.profile.modelId).toBe("old/model");
				expect(f.counts().closes).toBe(1);
			}),
	);
	it.scoped(
		"rejects other-device capture without stopping the owner and ignores stale generations",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture();
				yield* f.runtime.startCapture(request);
				yield* Queue.take(f.opened);
				yield* Queue.take(f.listening);
				const busy = yield* f.runtime
					.startCapture({ ...request, serial: "two" })
					.pipe(Effect.either);
				expect(Either.isLeft(busy) && busy.left.code).toBe("VOICE.KNOB.BUSY");
				expect(f.counts().closes).toBe(0);
				yield* f.runtime.releaseCapture("one", "0,1", 0);
				expect(f.sent).toHaveLength(0);
				yield* f.runtime.releaseCapture("one", "0,1", 1);
				yield* tick;
				expect(f.sent).toHaveLength(1);
			}),
	);
	it.scoped(
		"fails busy at two seconds, retains cleanup ownership and starts only after cleanup",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture(true);
				yield* f.runtime.startCapture(request);
				yield* Queue.take(f.opened);
				yield* Queue.take(f.listening);
				const next = { ...request, captureId: "knob/2", generation: 2 };
				yield* f.runtime.startCapture(next);
				yield* tick;
				yield* TestClock.adjust("1999 millis");
				expect(
					f.events.some((e) => e._tag === "Stage" && e.stage._tag === "failed"),
				).toBe(false);
				yield* TestClock.adjust("1 millis");
				yield* tick;
				expect(
					f.events.some(
						(e) =>
							e._tag === "Stage" &&
							e.stage._tag === "failed" &&
							e.stage.errorCode === "VOICE.KNOB.BUSY",
					),
				).toBe(true);
				expect(f.counts().permissions).toBe(1);
				yield* Deferred.succeed(f.clean, undefined);
				yield* tick;
				yield* f.runtime.startCapture(next);
				yield* Queue.take(f.opened);
				yield* Queue.take(f.listening);
				yield* f.runtime.releaseCapture("one", "0,1", 1);
				expect(f.sent).toHaveLength(0);
				yield* f.runtime.releaseCapture("one", "0,1", 2);
				yield* tick;
				expect(f.sent).toHaveLength(1);
			}),
	);
	it.scoped(
		"release while route resolution is pending never reaches microphone permission",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture(false, true);
				yield* f.runtime.startCapture(request);
				yield* Deferred.await(f.pinned);
				yield* f.runtime.releaseCapture("one", "0,1", 1);
				yield* Deferred.succeed(f.pin, undefined);
				yield* tick;
				expect(f.counts().permissions).toBe(0);
				expect(f.sent).toHaveLength(0);
			}),
	);
	it.scoped(
		"profile removal cancels capture and also cancels an accepted response",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture();
				yield* f.runtime.startCapture(request);
				yield* Queue.take(f.opened);
				yield* Queue.take(f.listening);
				yield* f.reconcileProfiles([]);
				yield* tick;
				expect(f.counts().closes).toBe(1);
				expect(f.sent).toHaveLength(0);
				yield* f.runtime.startCapture({ ...request, generation: 2 });
				yield* Queue.take(f.opened);
				yield* Queue.take(f.listening);
				yield* f.runtime.releaseCapture("one", "0,1", 2);
				yield* tick;
				expect(f.sent).toHaveLength(1);
				const prior = f.cancels.length;
				yield* f.reconcileProfiles([]);
				expect(f.cancels.length).toBe(prior + 1);
			}),
	);
	it.scoped(
		"release during cleanup latches cancellation without opening a successor microphone",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture(true);
				yield* f.runtime.startCapture(request);
				yield* Queue.take(f.opened);
				yield* Queue.take(f.listening);
				yield* f.runtime.startCapture({
					...request,
					captureId: "knob/2",
					generation: 2,
				});
				yield* tick;
				yield* f.runtime.releaseCapture("one", "0,1", 2);
				yield* Deferred.succeed(f.clean, undefined);
				yield* tick;
				expect(f.counts().permissions).toBe(1);
				expect(f.counts().closes).toBe(1);
				expect(f.sent).toHaveLength(0);
			}),
	);
	it.scoped(
		"removal while provider resolution is pending prevents microphone access",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture(false, true);
				yield* f.runtime.startCapture(request);
				yield* Deferred.await(f.pinned);
				yield* f.reconcileProfiles([]);
				yield* Deferred.succeed(f.pin, undefined);
				yield* tick;
				expect(f.counts().permissions).toBe(0);
				expect(f.sent).toHaveLength(0);
			}),
	);
	it.scoped(
		"incomplete saved provider never reaches microphone permission",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture(false, false, true);
				yield* f.runtime.startCapture(request);
				yield* tick;
				expect(f.counts().permissions).toBe(0);
				expect(
					f.events.some(
						(e) =>
							e._tag === "Stage" &&
							e.stage._tag === "failed" &&
							e.stage.errorCode === "VOICE.KNOB.ROUTE_INCOMPLETE",
					),
				).toBe(true);
			}),
	);
	it.scoped("bounds stalled provider resolution before microphone access", () =>
		Effect.gen(function* () {
			const f = yield* fixture(false, true);
			yield* f.runtime.startCapture(request);
			yield* Deferred.await(f.pinned);
			yield* TestClock.adjust("10 seconds");
			yield* tick;
			expect(f.counts().permissions).toBe(0);
			expect(
				f.events.some(
					(e) =>
						e._tag === "Stage" &&
						e.stage._tag === "failed" &&
						e.stage.errorCode === "VOICE.KNOB.ROUTE_INCOMPLETE",
				),
			).toBe(true);
		}),
	);
	it.scoped(
		"duplicate hold-start reports do not create a second microphone",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture();
				yield* f.runtime.startCapture(request);
				yield* Queue.take(f.opened);
				yield* Queue.take(f.listening);
				yield* f.runtime.startCapture(request);
				yield* tick;
				expect(f.counts().permissions).toBe(1);
				expect(f.counts().closes).toBe(0);
				yield* f.runtime.releaseCapture("one", "0,1", 1);
				yield* tick;
				expect(f.sent).toHaveLength(1);
			}),
	);
});

describe("profile-removal speech isolation", () => {
	const sessionId = SessionId.make("00000000-0000-4000-8000-000000000010");
	const turnId = TurnId.make("00000000-0000-4000-8000-000000000011");
	it.scoped(
		"profile removal cancels only the affected device answer turn",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture();
				for (const capture of [
					request,
					{
						...request,
						serial: "two",
						knob: {
							profileId: "kept",
							revision: 7,
							route: "direct" as const,
							providerId: "saved",
							modelId: "old/model",
						},
					},
				]) {
					yield* f.runtime.startCapture(capture);
					yield* Queue.take(f.opened);
					yield* Queue.take(f.listening);
					yield* f.runtime.releaseCapture(capture.serial, "0,1", 1);
					yield* tick;
				}
				for (const serial of ["one", "two"]) {
					yield* f.observe({
						_tag: "TurnStarted",
						serial,
						keyCode: "0,1",
						sessionId,
						turnId,
						prompt: "input",
						source: "voice",
					});
					yield* f.observe({
						_tag: "Chunk",
						serial,
						keyCode: "0,1",
						chunk: {
							version: 1,
							sessionId,
							turnId,
							seq: 0,
							type: "answer",
							textDelta: `${serial} answer.`,
						},
					});
					expect(yield* Queue.take(f.spoken)).toBe(`${serial} answer.`);
				}
				const prior = f.cancels.length;
				yield* f.reconcileProfiles(["kept"]);
				expect(f.cancels.slice(prior)).toEqual(["one"]);
				expect(f.cancelledSpeech).toEqual(["one answer."]);
				yield* f.cancelSpeech();
				expect(f.cancelledSpeech).toEqual(["one answer.", "two answer."]);
			}),
	);
	it.scoped("profile removal preserves unrelated read-aloud playback", () =>
		Effect.gen(function* () {
			const f = yield* fixture();
			yield* f.runtime.startCapture(request);
			yield* Queue.take(f.opened);
			yield* Queue.take(f.listening);
			yield* f.runtime.releaseCapture("one", "0,1", 1);
			yield* tick;
			const reading = yield* f
				.readAloud("unrelated read-aloud")
				.pipe(Effect.fork);
			expect(yield* Queue.take(f.spoken)).toBe("unrelated read-aloud");
			yield* f.reconcileProfiles([]);
			expect(f.cancelledSpeech).toEqual([]);
			expect(Option.isNone(yield* Fiber.poll(reading))).toBe(true);
			yield* f.cancelSpeech();
			expect(yield* Fiber.join(reading)).toEqual({ _tag: "cancelled" });
		}),
	);
});
