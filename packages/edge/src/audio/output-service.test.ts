import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Either,
	Fiber,
	Option,
	Schema,
	TestClock,
} from "effect";
import { AudioOutputBusy, AudioOutputFailed } from "./output-errors.js";
import { makeAudioOutput } from "./output-service.js";

describe("shared audio ownership", () => {
	it("round-trips catalog errors without exposing or inventing private causes", () => {
		const cause = Object.assign(new Error("/private/audio secret"), {
			code: "EACCES",
		});
		const failed = new AudioOutputFailed(cause);
		const wire = Schema.encodeSync(AudioOutputFailed)(failed);
		expect(wire.diagnosticCause.sourceCode).toBe("EACCES");
		expect(JSON.stringify(wire)).not.toMatch(/private|secret/);
		const decoded = Schema.decodeUnknownSync(AudioOutputFailed)(wire);
		expect(decoded.code).toBe(failed.code);
		expect(decoded.diagnosticCause).toEqual(failed.diagnosticCause);
		expect(decoded.originalCause).toBeUndefined();
		const busy = new AudioOutputBusy();
		expect(
			Schema.decodeUnknownSync(AudioOutputBusy)(
				Schema.encodeSync(AudioOutputBusy)(busy),
			).code,
		).toBe("QUAKE.AUDIO.OUTPUT_BUSY");
	});

	it.effect(
		"preempts an entire soundboard group before capture and never resumes it",
		() =>
			Effect.gen(function* () {
				const owner = yield* makeAudioOutput;
				const sessions = new Set(["A", "B", "A-add"]);
				let stops = 0;
				const board = yield* owner.acquire(
					"soundboard",
					Effect.sync(() => {
						sessions.clear();
						stops++;
					}),
				);
				const capture = yield* owner.acquire("capture", Effect.void);
				expect(sessions.size).toBe(0);
				expect(yield* board.current).toBe(false);
				expect(
					yield* owner.acquire("soundboard", Effect.void).pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_BUSY" },
				});
				expect(
					yield* owner.acquire("speech", Effect.void).pipe(Effect.either),
				).toMatchObject({ _tag: "Left" });
				yield* capture.release;
				expect(sessions.size).toBe(0);
				const speech = yield* owner.acquire("speech", Effect.void);
				yield* board.release;
				yield* board.release;
				expect(yield* speech.current).toBe(true);
				expect(stops).toBe(1);
				yield* speech.release;
			}),
	);
	it.effect(
		"serializes competing speech requests until old native teardown actually finishes",
		() =>
			Effect.gen(function* () {
				const owner = yield* makeAudioOutput;
				const stopping = yield* Deferred.make<void>();
				const stopped = yield* Deferred.make<void>();
				yield* owner.acquire(
					"soundboard",
					Deferred.succeed(stopping, undefined).pipe(
						Effect.zipRight(Deferred.await(stopped)),
					),
				);
				const first = yield* owner
					.acquire("speech", Effect.void)
					.pipe(Effect.fork);
				yield* Deferred.await(stopping);
				const second = yield* owner
					.acquire("speech", Effect.void)
					.pipe(Effect.fork);
				yield* Effect.yieldNow();
				expect(Option.isNone(yield* Fiber.poll(second))).toBe(true);
				yield* Deferred.succeed(stopped, undefined);
				const a = yield* Fiber.join(first);
				const b = yield* Fiber.join(second);
				expect(yield* a.current).toBe(false);
				expect(yield* b.current).toBe(true);
				yield* b.release;
			}),
	);
	it.effect(
		"keeps output busy until release cleanup completes and stops once under duplicate release",
		() =>
			Effect.gen(function* () {
				const owner = yield* makeAudioOutput;
				const stopping = yield* Deferred.make<void>();
				const stopped = yield* Deferred.make<void>();
				let count = 0;
				const lease = yield* owner.acquire(
					"soundboard",
					Effect.sync(() => {
						count++;
					}).pipe(
						Effect.zipRight(Deferred.succeed(stopping, undefined)),
						Effect.zipRight(Deferred.await(stopped)),
					),
				);
				const release = yield* lease.release.pipe(Effect.fork);
				yield* Deferred.await(stopping);
				expect(
					yield* owner.acquire("soundboard", Effect.void).pipe(Effect.either),
				).toMatchObject({ _tag: "Left" });
				const duplicate = yield* lease.release.pipe(Effect.fork);
				yield* Deferred.succeed(stopped, undefined);
				yield* Fiber.join(release);
				yield* Fiber.join(duplicate);
				expect(count).toBe(1);
				const next = yield* owner.acquire("soundboard", Effect.void);
				yield* next.release;
			}),
	);
	it.effect(
		"cleans an acquisition interrupted while the previous native lease is stopping",
		() =>
			Effect.gen(function* () {
				const owner = yield* makeAudioOutput;
				const entered = yield* Deferred.make<void>();
				const done = yield* Deferred.make<void>();
				yield* owner.acquire(
					"soundboard",
					Deferred.succeed(entered, undefined).pipe(
						Effect.zipRight(Deferred.await(done)),
					),
				);
				let stopped = 0;
				const pending = yield* owner
					.acquire(
						"speech",
						Effect.sync(() => {
							stopped++;
						}),
					)
					.pipe(Effect.fork);
				yield* Deferred.await(entered);
				const interrupted = yield* Fiber.interrupt(pending).pipe(Effect.fork);
				yield* Deferred.succeed(done, undefined);
				yield* Fiber.join(interrupted);
				expect(stopped).toBe(1);
				const board = yield* owner.acquire("soundboard", Effect.void);
				yield* board.release;
			}),
	);

	it.effect(
		"bounds stalled teardown and fails closed without granting a new owner",
		() =>
			Effect.gen(function* () {
				const owner = yield* makeAudioOutput;
				yield* owner.acquire("soundboard", Effect.never);
				const capture = yield* owner
					.acquire("capture", Effect.void)
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(2000);
				expect(yield* Fiber.join(capture)).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_FAILED" },
				});
				expect(
					yield* owner.acquire("speech", Effect.void).pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_FAILED" },
				});
			}),
	);
	it.effect(
		"retains native cleanup defects privately and scrubs serialized errors",
		() =>
			Effect.gen(function* () {
				const owner = yield* makeAudioOutput;
				const original = Object.assign(
					new Error("/private/music.mp3 token=secret"),
					{ code: "EACCES" },
				);
				yield* owner.acquire("soundboard", Effect.die(original));
				const result = yield* owner
					.acquire("speech", Effect.void)
					.pipe(Effect.either);
				expect(Either.isLeft(result)).toBe(true);
				if (Either.isLeft(result)) {
					expect(result.left).toBeInstanceOf(AudioOutputFailed);
					expect(result.left.originalCause).toBe(original);
					expect(JSON.stringify(result.left)).not.toMatch(
						/private|secret|music/,
					);
				}
			}),
	);
	it.effect(
		"shutdown waits for in-flight preemption and refuses the replacement lease",
		() =>
			Effect.gen(function* () {
				const owner = yield* makeAudioOutput;
				const stopping = yield* Deferred.make<void>();
				const stopped = yield* Deferred.make<void>();
				let replacementStops = 0;
				const board = yield* owner.acquire(
					"soundboard",
					Deferred.succeed(stopping, undefined).pipe(
						Effect.zipRight(Deferred.await(stopped)),
					),
				);
				const acquisition = yield* owner
					.acquire(
						"capture",
						Effect.sync(() => {
							replacementStops++;
						}),
					)
					.pipe(Effect.either, Effect.fork);
				yield* Deferred.await(stopping);
				const closing = yield* owner.close().pipe(Effect.fork);
				yield* TestClock.adjust(1);
				expect(Option.isNone(yield* Fiber.poll(closing))).toBe(true);
				expect(yield* board.current).toBe(false);
				yield* Deferred.succeed(stopped, undefined);
				yield* Fiber.join(closing);
				expect(yield* Fiber.join(acquisition)).toMatchObject({ _tag: "Left" });
				expect(replacementStops).toBe(1);
				yield* owner.close();
				expect(
					yield* owner.acquire("speech", Effect.void).pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_FAILED" },
				});
			}),
	);
	it.effect(
		"shutdown waits for bounded preemption failure and never grants output afterward",
		() =>
			Effect.gen(function* () {
				const owner = yield* makeAudioOutput;
				const stopping = yield* Deferred.make<void>();
				yield* owner.acquire(
					"soundboard",
					Deferred.succeed(stopping, undefined).pipe(
						Effect.zipRight(Effect.never),
					),
				);
				const acquisition = yield* owner
					.acquire("capture", Effect.void)
					.pipe(Effect.either, Effect.fork);
				yield* Deferred.await(stopping);
				const closing = yield* owner.close().pipe(Effect.fork);
				yield* TestClock.adjust(1);
				expect(Option.isNone(yield* Fiber.poll(closing))).toBe(true);
				yield* TestClock.adjust(2000);
				yield* Fiber.join(closing);
				expect(yield* Fiber.join(acquisition)).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_FAILED" },
				});
				expect(
					yield* owner.acquire("speech", Effect.void).pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_FAILED" },
				});
			}),
	);
	it.effect(
		"closes idempotently, refuses late acquisition and cannot revive old leases",
		() =>
			Effect.gen(function* () {
				const owner = yield* makeAudioOutput;
				let stops = 0;
				const lease = yield* owner.acquire(
					"speech",
					Effect.sync(() => {
						stops++;
					}),
				);
				yield* owner.close();
				yield* owner.close();
				yield* lease.release;
				expect(stops).toBe(1);
				expect(yield* lease.current).toBe(false);
				expect(
					yield* owner.acquire("soundboard", Effect.void).pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_FAILED" },
				});
			}),
	);
});
