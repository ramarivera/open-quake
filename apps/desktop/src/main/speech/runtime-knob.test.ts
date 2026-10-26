import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Either,
	Layer,
	Option,
	Queue,
	Stream,
	TestClock,
} from "effect";
import { AiUnavailable } from "../../../../../packages/edge/src/ai/ai-errors";
import { AiSpeechService } from "../../../../../packages/edge/src/ai/speech/speech-service";
import { sttProfile } from "../../../../../packages/edge/src/ai/speech/speech-test-fixtures";
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
	const clean = yield* Deferred.make<void>();
	const pinned = yield* Deferred.make<void>();
	const pin = yield* Deferred.make<void>();
	let permissions = 0;
	let closes = 0;
	let selected = profile;
	const speech = AiSpeechService.make({
		synthesize: () => Effect.fail(new AiUnavailable()),
		createSpeech: () =>
			Effect.succeed({
				result: Effect.succeed({ _tag: "completed" as const }),
				cancel: () => Effect.void,
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
		profiles: () => Effect.succeed({ stt: sttProfile, speakAnswers: false }),
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
