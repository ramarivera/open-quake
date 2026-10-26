import { expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Fiber,
	Layer,
	Option,
	Queue,
	Redacted,
	TestClock,
} from "effect";
import { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import {
	SpeechHttp,
	SpeechOutput,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { AiSpeechService } from "../../../../../packages/edge/src/ai/speech/speech-service";
import {
	ttsProfile,
	wav,
} from "../../../../../packages/edge/src/ai/speech/speech-test-fixtures";
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

const owner = { serial: "fake", keyCode: "1,5" };
const tick = Effect.yieldNow().pipe(Effect.repeatN(10));
const fixture = Effect.fn("ReadAloudTest.fixture")(function* (
	mode: "ready" | "play" | "noAudio" | "stream",
	suspended = false,
	prefixBytes = 100,
	metadata = false,
) {
	const ready = yield* Deferred.make<void>();
	const play = yield* Queue.unbounded<void>();
	const drain = yield* Deferred.make<void>();
	const received = yield* Deferred.make<void>();
	let releaseAudio = () => {};
	let view = initialVoiceView;
	const events: VoiceSurfaceEvent[] = [];
	let requests = 0,
		stopped = 0,
		resumes = 0,
		aborted = 0;
	let context = suspended ? "suspended" : "running";
	const data = new Uint8Array(480044 + (metadata ? 12 : 0));
	data.set(wav().subarray(0, 44));
	const header = new DataView(data.buffer);
	header.setUint32(4, data.length - 8, true);
	if (metadata) {
		data.set(new TextEncoder().encode("JUNK"), 36);
		header.setUint32(40, 3, true);
		data.set([1, 2, 3, 0], 44);
		data.set(new TextEncoder().encode("data"), 48);
	}
	header.setUint32(metadata ? 52 : 40, 480000, true);
	const layer = Layer.mergeAll(
		VoiceSurface.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(VoiceTonePort, { play: () => Effect.void }),
					Layer.succeed(VoiceSurfacePublisher, {
						publish: (event) =>
							Effect.sync(() => {
								events.push(event);
								view = reduceVoice(
									view,
									{ _tag: "event", event },
									new Map(),
									0,
								);
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
					Layer.succeed(SpeechHttp, {
						fetch: async (_url, init) => {
							requests++;
							if (mode === "noAudio")
								return new Promise<Response>((_resolve, reject) => {
									init.signal?.addEventListener(
										"abort",
										() => {
											aborted++;
											reject(new DOMException("Canceled", "AbortError"));
										},
										{ once: true },
									);
								});
							if (mode === "stream")
								return new Response(
									new ReadableStream({
										start: (stream) => {
											for (let i = 0; i < prefixBytes; i++)
												stream.enqueue(data.slice(i, i + 1));
											releaseAudio = () => {
												stream.enqueue(data.slice(prefixBytes));
												stream.close();
											};
											Effect.runSync(Deferred.succeed(received, undefined));
										},
									}),
									{ headers: { "Content-Type": "audio/wav" } },
								);
							return new Response(data, {
								headers: { "Content-Type": "audio/wav" },
							});
						},
					}),
					Layer.succeed(SpeechOutput, {
						suspendForCapture: Effect.void,
						acquire: Effect.succeed({
							ready: Deferred.succeed(ready, undefined).pipe(
								Effect.zipRight(
									mode === "ready" ? Deferred.await(drain) : Effect.void,
								),
							),
							contextState: Effect.sync(() => context),
							resume: Effect.sync(() => {
								resumes++;
								context = "running";
							}),
							play: () =>
								Queue.offer(play, undefined).pipe(
									Effect.zipRight(Deferred.await(drain)),
								),
							stop: Effect.sync(() => {
								stopped++;
							}),
						}),
					}),
				),
			),
		),
	);
	return {
		layer,
		ready,
		play,
		drain,
		received,
		releaseAudio: () => releaseAudio(),
		events,
		view: () => view,
		counts: () => ({ requests, stopped, resumes, aborted }),
	};
});
const controller = () =>
	Effect.gen(function* () {
		return yield* createProductionVoiceRuntime({
			speech: yield* AiSpeechService,
			capture: {
				permission: Effect.die("no real mic"),
				open: () => Effect.die("no real mic"),
			},
			profiles: () => Effect.succeed({ tts: ttsProfile, speakAnswers: false }),
			sendText: () => Effect.void,
			sendTranscript: () => Effect.void,
		});
	});

for (const mode of ["play", "noAudio"] as const) {
	it.effect(
		`owner stop cancels ${mode} without starting speech for stale or foreign owners`,
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const f = yield* fixture(mode);
					yield* Effect.gen(function* () {
						const c = yield* controller();
						const first = yield* c
							.readAloud("Streaming answer", owner)
							.pipe(Effect.fork);
						if (mode === "play") yield* Queue.take(f.play);
						else yield* tick;
						expect(
							yield* c.stopReadAloud({ ...owner, serial: "foreign" }),
						).toBe(false);
						expect(yield* c.stopReadAloud({ ...owner, keyCode: "1,6" })).toBe(
							false,
						);
						expect(yield* c.stopReadAloud(owner)).toBe(true);
						expect(yield* Fiber.join(first)).toEqual({ _tag: "cancelled" });
						expect(f.view().readAloud.get(owner.keyCode)?.phase).toBe("idle");
						expect(yield* c.stopReadAloud(owner)).toBe(false);
						expect(f.counts()).toMatchObject({
							requests: 1,
							stopped: mode === "play" ? 1 : 0,
						});
					}).pipe(Effect.provide(f.layer));
				}),
			),
	);
}

for (const mode of ["ready", "play", "noAudio"] as const) {
	it.effect(
		`second tap stops ${mode} without another synthesis and publishes idle to the consumer`,
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const f = yield* fixture(mode);
					yield* Effect.gen(function* () {
						const c = yield* controller();
						const first = yield* c
							.readAloud("The answer stays.", owner)
							.pipe(Effect.fork);
						if (mode === "ready") yield* Deferred.await(f.ready);
						else if (mode === "play") yield* Queue.take(f.play);
						else yield* tick;
						expect(f.view().readAloud.get(owner.keyCode)?.phase).toBe(
							mode === "play" ? "speaking" : "thinking",
						);
						expect(yield* c.readAloud("Changed answer", owner)).toEqual({
							_tag: "completed",
						});
						expect(yield* Fiber.join(first)).toEqual({ _tag: "cancelled" });
						expect(f.view().readAloud.get(owner.keyCode)?.phase).toBe("idle");
						expect(f.counts()).toMatchObject({
							requests: 1,
							stopped: mode === "noAudio" ? 0 : 1,
						});
						if (mode === "noAudio") expect(f.counts().aborted).toBe(1);
						expect(
							f.events
								.filter((e) => e._tag === "ReadAloudState")
								.map((e) => e.phase),
						).toEqual(
							mode === "play"
								? ["thinking", "speaking", "idle"]
								: ["thinking", "idle"],
						);
					}).pipe(Effect.provide(f.layer));
				}),
			),
	);
}

it.effect(
	"resume runs once at 8 seconds and a still-stalled 10-second segment expires after the restarted duration + 5 seconds",
	() =>
		Effect.scoped(
			Effect.gen(function* () {
				const f = yield* fixture("play", true);
				yield* Effect.gen(function* () {
					const c = yield* controller();
					const first = yield* c.readAloud("Answer", owner).pipe(Effect.fork);
					yield* Queue.take(f.play);
					yield* TestClock.adjust(7999);
					expect(f.counts().resumes).toBe(0);
					yield* TestClock.adjust(1);
					expect(f.counts().resumes).toBe(1);
					yield* TestClock.adjust(14999);
					expect(Option.isNone(yield* Fiber.poll(first))).toBe(true);
					yield* TestClock.adjust(1);
					const result = yield* Fiber.join(first);
					expect(result).toMatchObject({
						_tag: "textOnly",
						error: { code: "VOICE.CAPTURE.PHASE_TIMEOUT", phase: "playback" },
					});
					expect(f.counts()).toMatchObject({
						requests: 1,
						stopped: 1,
						resumes: 1,
					});
					expect(f.view().readAloud.get(owner.keyCode)?.phase).toBe("idle");
				}).pipe(Effect.provide(f.layer));
			}),
		),
);

it.effect(
	"running context stalls at exactly duration + 5 seconds, then a new key can speak and stale idle cannot stop it",
	() =>
		Effect.scoped(
			Effect.gen(function* () {
				const f = yield* fixture("play");
				yield* Effect.gen(function* () {
					const c = yield* controller();
					const first = yield* c.readAloud("First", owner).pipe(Effect.fork);
					yield* Queue.take(f.play);
					yield* TestClock.adjust(14999);
					expect(Option.isNone(yield* Fiber.poll(first))).toBe(true);
					yield* TestClock.adjust(1);
					expect(yield* Fiber.join(first)).toMatchObject({ _tag: "textOnly" });
					const second = yield* c
						.readAloud("Second", { ...owner, keyCode: "1,6" })
						.pipe(Effect.fork);
					yield* Queue.take(f.play);
					expect(f.view().readAloud.get("1,6")?.phase).toBe("speaking");
					yield* c.reset();
					expect(yield* Fiber.join(second)).toEqual({ _tag: "cancelled" });
					expect(f.view().readAloud.get("1,6")?.phase).toBe("idle");
					expect(f.counts()).toMatchObject({
						requests: 2,
						stopped: 2,
						resumes: 0,
					});
				}).pipe(Effect.provide(f.layer));
			}),
		),
);

it.effect(
	"12-second no-audio deadline aborts synthesis and clears the consumer without acquiring output",
	() =>
		Effect.scoped(
			Effect.gen(function* () {
				const f = yield* fixture("noAudio");
				yield* Effect.gen(function* () {
					const c = yield* controller();
					const first = yield* c.readAloud("First", owner).pipe(Effect.fork);
					yield* tick;
					yield* TestClock.adjust(11999);
					expect(Option.isNone(yield* Fiber.poll(first))).toBe(true);
					yield* TestClock.adjust(1);
					expect(yield* Fiber.join(first)).toMatchObject({
						_tag: "textOnly",
						error: { phase: "synthesis" },
					});
					expect(f.counts()).toMatchObject({
						requests: 1,
						stopped: 0,
						aborted: 1,
					});
					expect(f.view().readAloud.get(owner.keyCode)?.phase).toBe("idle");
				}).pipe(Effect.provide(f.layer));
			}),
		),
);

it.effect(
	"another key replaces active playback after teardown and stale feedback cannot clear its pill",
	() =>
		Effect.scoped(
			Effect.gen(function* () {
				const f = yield* fixture("play");
				yield* Effect.gen(function* () {
					const c = yield* controller();
					const first = yield* c.readAloud("First", owner).pipe(Effect.fork);
					yield* Queue.take(f.play);
					const old = f.events.find((e) => e._tag === "ReadAloudState");
					const second = yield* c
						.readAloud("Second", { ...owner, keyCode: "1,6" })
						.pipe(Effect.fork);
					yield* Queue.take(f.play);
					expect(yield* Fiber.join(first)).toEqual({ _tag: "cancelled" });
					expect(f.counts()).toMatchObject({ stopped: 1, requests: 2 });
					let view = f.view();
					if (old?._tag !== "ReadAloudState")
						return yield* Effect.die("missing phase");
					view = reduceVoice(
						view,
						{ _tag: "event", event: { ...old, keyCode: "1,6", phase: "idle" } },
						new Map(),
						0,
					);
					expect(view.readAloud.get("1,6")?.phase).toBe("speaking");
					yield* c.reset();
					yield* Fiber.join(second);
				}).pipe(Effect.provide(f.layer));
			}),
		),
);

for (const metadata of [false, true]) {
	it.effect(
		`WAV header without PCM times out at 12 seconds and clears the read-aloud pill, metadata ${metadata}`,
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const f = yield* fixture(
						"stream",
						false,
						metadata ? 56 : 44,
						metadata,
					);
					yield* Effect.gen(function* () {
						const c = yield* controller();
						const first = yield* c
							.readAloud("Header only", owner)
							.pipe(Effect.fork);
						yield* Deferred.await(f.received);
						yield* tick;
						yield* TestClock.adjust(11999);
						expect(Option.isNone(yield* Fiber.poll(first))).toBe(true);
						yield* TestClock.adjust(1);
						yield* tick;
						expect(Option.isSome(yield* Fiber.poll(first))).toBe(true);
						expect(yield* Fiber.join(first)).toMatchObject({
							_tag: "textOnly",
							error: { phase: "synthesis" },
						});
						expect(f.counts()).toMatchObject({ requests: 1, stopped: 0 });
						expect(f.view().readAloud.get(owner.keyCode)?.phase).toBe("idle");
					}).pipe(Effect.provide(f.layer));
				}),
			),
	);
}

for (const metadata of [false, true]) {
	it.effect(
		`audio received before 12 seconds cancels the no-audio watchdog while the response continues, metadata ${metadata}`,
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const f = yield* fixture(
						"stream",
						false,
						metadata ? 58 : 46,
						metadata,
					);
					yield* Effect.gen(function* () {
						const c = yield* controller();
						const first = yield* c
							.readAloud("Streaming", owner)
							.pipe(Effect.fork);
						yield* Deferred.await(f.received);
						yield* tick;
						yield* TestClock.adjust(13000);
						expect(Option.isNone(yield* Fiber.poll(first))).toBe(true);
						f.releaseAudio();
						yield* Queue.take(f.play);
						expect(f.view().readAloud.get(owner.keyCode)?.phase).toBe(
							"speaking",
						);
						yield* c.reset();
						expect(yield* Fiber.join(first)).toEqual({ _tag: "cancelled" });
					}).pipe(Effect.provide(f.layer));
				}),
			),
	);
}
