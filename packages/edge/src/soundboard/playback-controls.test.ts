import { it } from "@effect/vitest";
import { Deferred, Effect, Either, Fiber, Option, TestClock } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { owner, playlist, rig } from "./playback-test-fixtures.js";
import { SoundboardDecodeFailed } from "./soundboard-errors.js";

describe("soundboard controls with real conductor and output ownership", () => {
	it.scoped(
		"navigation honors incoming and outgoing key fades without holding the command gate",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const session = yield* r.service.play(owner, playlist);
				const next = yield* r.service
					.execute(
						owner,
						{ ...playlist, fade: { mode: "in", durationMs: 1000 } },
						"PLAY_NEXT",
					)
					.pipe(Effect.fork);
				yield* TestClock.adjust(500);
				expect(r.tracks.at(-1)?.fileId).toBe("b");
				expect((yield* r.service.snapshot())[0]?.gain).toBeCloseTo(0.25, 2);
				yield* TestClock.adjust(500);
				yield* Fiber.join(next);
				const previous = yield* r.service
					.execute(
						owner,
						{ ...playlist, fade: { mode: "out", durationMs: 1000 } },
						"PLAY_PREV",
					)
					.pipe(Effect.fork);
				yield* TestClock.adjust(500);
				expect(r.tracks.at(-1)?.fileId).toBe("b");
				yield* TestClock.adjust(500);
				yield* Fiber.join(previous);
				expect(r.tracks.at(-1)?.fileId).toBe("a");
				expect((yield* r.service.snapshot())[0]).toMatchObject({
					playbackId: session.playbackId,
					gain: 0.5,
				});
				yield* r.service.stopAll();
				const stoppedNavigation = yield* r.service
					.execute(
						owner,
						{ ...playlist, fade: { mode: "in", durationMs: 1000 } },
						"PLAY_NEXT",
					)
					.pipe(Effect.fork);
				yield* TestClock.adjust(500);
				expect(r.tracks.at(-1)?.fileId).toBe("b");
				expect((yield* r.service.snapshot()).at(-1)?.gain).toBeCloseTo(0.25, 2);
				yield* TestClock.adjust(500);
				yield* Fiber.join(stoppedNavigation);
			}),
	);
	it.scoped(
		"bounds a stuck pause and cancels native control work when its caller is interrupted",
		() =>
			Effect.gen(function* () {
				const r = yield* rig(
					Effect.void,
					Effect.void,
					Effect.void,
					Effect.void,
					(method) => (method === "pause" ? Effect.never : Effect.void),
				);
				const first = yield* r.service.play(owner, playlist);
				const pause = yield* r.service
					.pause(first.playbackId)
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(2000);
				expect(yield* Fiber.join(pause)).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.DECODE_FAILED" },
				});
				expect(r.tracks[0]?.closed).toBe(1);
				const next = yield* r.service.play(owner, playlist);
				const pending = yield* r.service
					.pause(next.playbackId)
					.pipe(Effect.fork);
				yield* TestClock.adjust(1);
				yield* Fiber.interrupt(pending);
				expect(r.tracks[1]?.closed).toBe(1);
				const speech = yield* r.output.acquire("speech", Effect.void);
				yield* speech.release;
			}),
	);
	it.scoped(
		"interrupting a started play or Stop fade closes its own player immediately",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const play = yield* r.service
					.play(owner, { ...playlist, fade: { mode: "in", durationMs: 1000 } })
					.pipe(Effect.fork);
				yield* TestClock.adjust(200);
				yield* Fiber.interrupt(play);
				expect(r.tracks[0]?.closed).toBe(1);
				const session = yield* r.service.play(owner, playlist);
				const stop = yield* r.service
					.stop(session.playbackId, { mode: "out", durationMs: 1000 })
					.pipe(Effect.fork);
				yield* TestClock.adjust(200);
				yield* Fiber.interrupt(stop);
				expect(r.tracks[1]?.closed).toBe(1);
				expect(
					(yield* r.service.snapshot()).every(
						(record) => record.state === "stopped",
					),
				).toBe(true);
				const speech = yield* r.output.acquire("speech", Effect.void);
				yield* speech.release;
			}),
	);
	it.scoped(
		"natural end during Stop's fade releases the session instead of starting another track",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const session = yield* r.service.play(owner, playlist);
				const stop = yield* r.service
					.stop(session.playbackId, { mode: "out", durationMs: 1000 })
					.pipe(Effect.fork);
				yield* TestClock.adjust(200);
				const track = r.tracks[0];
				if (!track) return yield* Effect.die("missing track");
				yield* Deferred.succeed(track.end, undefined);
				yield* TestClock.adjust(1);
				yield* Fiber.join(stop);
				expect(r.tracks).toHaveLength(1);
				expect(track.closed).toBe(1);
				expect((yield* r.service.snapshot())[0]?.state).toBe("stopped");
			}),
	);
	test("arbitrary navigation and volume sequences preserve the selected track and bounded element gain", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(
					fc.record({
						next: fc.boolean(),
						volume: fc.integer({ min: 0, max: 100 }),
					}),
					{ minLength: 1, maxLength: 16 },
				),
				async (commands) => {
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const r = yield* rig();
								const session = yield* r.service.play(owner, playlist);
								let index = 0;
								for (const command of commands) {
									yield* r.service.setVolume(
										session.playbackId,
										command.volume,
									);
									yield* (command.next ? r.service.next : r.service.previous)(
										session.playbackId,
									);
									index = (index + (command.next ? 1 : 2)) % 3;
									expect((yield* r.service.snapshot())[0]).toMatchObject({
										trackIndex: index,
										gain: command.volume / 100,
										state: "playing",
									});
								}
								yield* r.service.close();
								expect(
									r.tracks.every(
										(track) =>
											track.closed === 1 &&
											track.gains.every((gain) => gain >= 0 && gain <= 1),
									),
								).toBe(true);
							}),
						),
					);
				},
			),
			{ numRuns: 24 },
		);
	});
	it.scoped(
		"an end arriving while paused advances once on resume without losing the native observation",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const session = yield* r.service.play(owner, playlist);
				yield* r.service.pause(session.playbackId);
				const track = r.tracks[0];
				if (!track) return yield* Effect.die("missing player");
				yield* Deferred.succeed(track.end, undefined);
				yield* TestClock.adjust(1);
				expect(r.tracks).toHaveLength(1);
				yield* r.service.resume(session.playbackId);
				expect(r.tracks.map((entry) => entry.fileId)).toEqual(["a", "b"]);
				yield* r.service.resume(session.playbackId);
				expect(r.tracks).toHaveLength(2);
			}),
	);
	it.scoped(
		"profile deactivation cancels that profile's pending metadata-stage play",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				const done = yield* Deferred.make<void>();
				const r = yield* rig(
					Effect.void,
					Effect.void,
					Deferred.succeed(entered, undefined).pipe(
						Effect.zipRight(Deferred.await(done)),
					),
				);
				const play = yield* r.service
					.play(owner, playlist)
					.pipe(Effect.either, Effect.fork);
				yield* Deferred.await(entered);
				yield* r.service.stopProfile(owner.profileId);
				yield* Deferred.succeed(done, undefined);
				expect(yield* Fiber.join(play)).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_BUSY" },
				});
				expect(r.tracks).toHaveLength(0);
			}),
	);
	it.scoped(
		"a later replacement supersedes an earlier metadata-stage request",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				const done = yield* Deferred.make<void>();
				let count = 0;
				const r = yield* rig(
					Effect.void,
					Effect.void,
					Effect.suspend(() =>
						++count === 1
							? Deferred.succeed(entered, undefined).pipe(
									Effect.zipRight(Deferred.await(done)),
								)
							: Effect.void,
					),
				);
				const old = yield* r.service
					.play(owner, playlist)
					.pipe(Effect.either, Effect.fork);
				yield* Deferred.await(entered);
				const newer = yield* r.service
					.play(owner, { ...playlist, volume: 80 })
					.pipe(Effect.fork);
				yield* TestClock.adjust(1);
				yield* Deferred.succeed(done, undefined);
				expect(yield* Fiber.join(old)).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_BUSY" },
				});
				const session = yield* Fiber.join(newer);
				expect(r.tracks).toHaveLength(1);
				expect(session.gain).toBe(0.8);
			}),
	);
	it.scoped(
		"stopped navigation selects its target without first decoding the remembered or missing track",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				r.unavailable.add(playlist.entries[0]?.path ?? "");
				yield* r.service.execute(owner, playlist, "PLAY_PREV");
				expect(r.tracks.map((track) => track.fileId)).toEqual(["c"]);
				yield* r.service.stopAll();
				yield* r.service.execute(owner, playlist, "PLAY_NEXT");
				expect(r.tracks.map((track) => track.fileId)).toEqual(["c", "b"]);
				yield* r.service.stopAll();
				for (const entry of playlist.entries) r.unavailable.add(entry.path);
				const inspected = r.inspected.length;
				yield* r.service.execute(owner, playlist, "PLAY_NEXT");
				expect(r.inspected.length - inspected).toBe(3);
				expect(r.tracks).toHaveLength(2);
			}),
	);
	it.scoped(
		"StopAll invalidates a replacement still validating before its outgoing fade",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				const done = yield* Deferred.make<void>();
				let count = 0;
				const r = yield* rig(
					Effect.void,
					Effect.void,
					Effect.suspend(() =>
						++count === 1
							? Effect.void
							: Deferred.succeed(entered, undefined).pipe(
									Effect.zipRight(Deferred.await(done)),
								),
					),
				);
				yield* r.service.play(owner, playlist);
				const replacement = yield* r.service
					.play(owner, { ...playlist, fade: { mode: "out", durationMs: 1000 } })
					.pipe(Effect.either, Effect.fork);
				yield* Deferred.await(entered);
				yield* r.service.stopAll();
				yield* Deferred.succeed(done, undefined);
				expect(yield* Fiber.join(replacement)).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_BUSY" },
				});
				expect(r.tracks).toHaveLength(1);
				expect(r.tracks[0]?.closed).toBe(1);
			}),
	);
	it.scoped(
		"new play cancels StopAll's fade without its late completion stopping the replacement",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				yield* r.service.play(owner, playlist);
				const stop = yield* r.service
					.stopAll({ mode: "out", durationMs: 1000 })
					.pipe(Effect.fork);
				yield* TestClock.adjust(200);
				const session = yield* r.service.play(owner, playlist);
				yield* Fiber.join(stop);
				yield* TestClock.adjust(1000);
				expect(
					(yield* r.service.snapshot()).find(
						(record) => record.playbackId === session.playbackId,
					)?.state,
				).toBe("playing");
				expect(r.tracks[1]?.closed).toBe(0);
			}),
	);
	it.scoped(
		"pause cancels an incoming ramp and the original command doesn't restart it later",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const start = yield* r.service
					.play(owner, { ...playlist, fade: { mode: "in", durationMs: 1000 } })
					.pipe(Effect.fork);
				yield* TestClock.adjust(400);
				const id = (yield* r.service.snapshot())[0]?.playbackId ?? "";
				yield* r.service.pause(id);
				yield* Fiber.join(start);
				const count = r.tracks[0]?.gains.length;
				yield* TestClock.adjust(2000);
				expect((yield* r.service.snapshot())[0]).toMatchObject({
					state: "paused",
					gain: 0.2,
				});
				expect(r.tracks[0]?.gains.length).toBe(count);
			}),
	);
	it.scoped(
		"control failures retain catalog identity and original cause, close the player, and free output",
		() =>
			Effect.gen(function* () {
				const original = Object.assign(
					new Error("/private/music token=secret"),
					{ code: "EACCES" },
				);
				const error = new SoundboardDecodeFailed(original);
				let broken = false;
				const r = yield* rig(
					Effect.void,
					Effect.void,
					Effect.void,
					Effect.void,
					(method) =>
						Effect.suspend(() =>
							broken && method === "pause" ? Effect.fail(error) : Effect.void,
						),
				);
				const session = yield* r.service.play(owner, playlist);
				broken = true;
				const result = yield* r.service
					.pause(session.playbackId)
					.pipe(Effect.either);
				expect(result).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.DECODE_FAILED" },
				});
				if (
					Either.isLeft(result) &&
					result.left._tag === "SoundboardDecodeFailed"
				) {
					expect(result.left.originalCause).toBe(original);
					expect(JSON.stringify(result.left)).not.toMatch(
						/private|music|secret/,
					);
				}
				expect((yield* r.service.snapshot())[0]).toMatchObject({
					state: "failed",
					errorCode: error.code,
				});
				expect(r.tracks[0]?.closed).toBe(1);
				const speech = yield* r.output.acquire("speech", Effect.void);
				yield* speech.release;
			}),
	);
	it.scoped(
		"a stalled native ramp write is cancelled before capture ownership and is bounded otherwise",
		() =>
			Effect.gen(function* () {
				let stalled = false;
				const r = yield* rig(
					Effect.void,
					Effect.void,
					Effect.void,
					Effect.void,
					(method) =>
						Effect.suspend(() =>
							stalled && method === "gain" ? Effect.never : Effect.void,
						),
				);
				const session = yield* r.service.play(owner, playlist);
				stalled = true;
				const ramp = yield* r.service
					.setVolume(session.playbackId, 20, 1000)
					.pipe(Effect.fork);
				yield* TestClock.adjust(1);
				const capture = yield* r.output.acquire("capture", Effect.void);
				yield* Fiber.join(ramp);
				expect(r.tracks[0]?.closed).toBe(1);
				yield* capture.release;
				stalled = false;
				const next = yield* r.service.play(owner, playlist);
				stalled = true;
				const failed = yield* r.service
					.setVolume(next.playbackId, 20)
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(2000);
				expect(yield* Fiber.join(failed)).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.DECODE_FAILED" },
				});
				expect(r.tracks[1]?.closed).toBe(1);
			}),
	);
	it.scoped(
		"pauses and resumes the same decoded player at the same position",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const session = yield* r.service.play(owner, playlist);
				const track = r.tracks[0];
				if (!track) return yield* Effect.die("missing player");
				track.positionMs = 4567;
				yield* r.service.pause(session.playbackId);
				expect((yield* r.service.snapshot())[0]).toMatchObject({
					state: "paused",
					positionMs: 4567,
				});
				yield* r.service.pause(session.playbackId);
				expect(track.pauses).toBe(1);
				yield* r.service.resume(session.playbackId);
				yield* r.service.resume(session.playbackId);
				expect(track.plays).toBe(2);
				expect(track.closed).toBe(0);
				expect(r.tracks).toHaveLength(1);
				expect((yield* r.service.snapshot())[0]).toMatchObject({
					state: "playing",
					positionMs: 4567,
					generation: session.generation,
				});
			}),
	);
	it.scoped(
		"wraps previous/next, skips missing entries, and stops after one unavailable traversal",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const session = yield* r.service.play(owner, playlist);
				yield* r.service.previous(session.playbackId);
				expect(r.tracks.at(-1)?.fileId).toBe("c");
				yield* r.service.next(session.playbackId);
				expect(r.tracks.at(-1)?.fileId).toBe("a");
				r.unavailable.add(playlist.entries[1]?.path ?? "");
				yield* r.service.next(session.playbackId);
				expect(r.tracks.at(-1)?.fileId).toBe("c");
				for (const entry of playlist.entries) r.unavailable.add(entry.path);
				const probes = r.inspected.length;
				yield* r.service.previous(session.playbackId);
				expect(r.inspected.length - probes).toBe(3);
				expect((yield* r.service.snapshot())[0]?.state).toBe("stopped");
				expect(r.tracks.every((track) => track.closed === 1)).toBe(true);
				const speech = yield* r.output.acquire("speech", Effect.void);
				yield* speech.release;
			}),
	);
	it.scoped(
		"rescans only configured paths without restarting the current decoded track",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const session = yield* r.service.play(owner, playlist);
				r.unavailable.add(playlist.entries[0]?.path ?? "");
				r.unavailable.add(playlist.entries[1]?.path ?? "");
				const probes = r.inspected.length;
				yield* r.service.rescan(session.playbackId);
				expect(r.inspected.slice(probes)).toEqual(
					playlist.entries.map((entry) => entry.path),
				);
				expect((yield* r.service.snapshot())[0]).toMatchObject({
					state: "playing",
					generation: session.generation,
					entries: [
						{ status: "missing" },
						{ status: "missing" },
						{ status: "available" },
					],
				});
				expect(r.tracks).toHaveLength(1);
				expect(r.tracks[0]).toMatchObject({ closed: 0, plays: 1 });
				yield* r.service.next(session.playbackId);
				expect(r.tracks.at(-1)?.fileId).toBe("c");
			}),
	);
	it.scoped(
		"ramps linearly within target volume and zero gain keeps playback alive",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const start = yield* r.service
					.play(owner, { ...playlist, fade: { mode: "in", durationMs: 1000 } })
					.pipe(Effect.fork);
				yield* TestClock.adjust(500);
				expect((yield* r.service.snapshot())[0]?.gain).toBeCloseTo(0.25, 2);
				expect(Option.isNone(yield* Fiber.poll(start))).toBe(true);
				yield* TestClock.adjust(500);
				const session = yield* Fiber.join(start);
				expect(session.gain).toBe(0.5);
				expect(
					r.tracks[0]?.gains.every((gain) => gain >= 0 && gain <= 0.5),
				).toBe(true);
				yield* r.service.setVolume(session.playbackId, 0);
				expect((yield* r.service.snapshot())[0]).toMatchObject({
					state: "playing",
					gain: 0,
				});
				expect(r.tracks[0]?.closed).toBe(0);
			}),
	);
	it.scoped(
		"waits for stop fade, but a newer volume command cancels it from current gain",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const session = yield* r.service.play(owner, playlist);
				const stop = yield* r.service
					.stop(session.playbackId, { mode: "out", durationMs: 1000 })
					.pipe(Effect.fork);
				yield* TestClock.adjust(500);
				expect((yield* r.service.snapshot())[0]?.gain).toBeCloseTo(0.25, 2);
				expect(r.tracks[0]?.closed).toBe(0);
				const from = r.tracks[0]?.gains.at(-1);
				const change = yield* r.service
					.setVolume(session.playbackId, 50, 500)
					.pipe(Effect.fork);
				yield* TestClock.adjust(1);
				yield* Fiber.join(stop);
				expect(r.tracks[0]?.gains).toContain(from);
				yield* TestClock.adjust(499);
				yield* Fiber.join(change);
				expect((yield* r.service.snapshot())[0]).toMatchObject({
					state: "playing",
					gain: 0.5,
				});
				yield* r.service.stop(session.playbackId, {
					mode: "out",
					durationMs: 0,
				});
				expect(r.tracks[0]?.closed).toBe(1);
			}),
	);
	it.scoped(
		"new play during fade-out cannot receive an old ramp or delayed stop",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const first = yield* r.service.play(owner, playlist);
				const stop = yield* r.service
					.stop(first.playbackId, { mode: "out", durationMs: 1000 })
					.pipe(Effect.fork);
				yield* TestClock.adjust(300);
				const next = yield* r.service.play(owner, playlist);
				yield* Fiber.join(stop);
				yield* TestClock.adjust(1000);
				expect(r.tracks[0]?.closed).toBe(1);
				expect(r.tracks[1]).toMatchObject({ closed: 0, gains: [0.5] });
				expect(
					(yield* r.service.snapshot()).find(
						(session) => session.playbackId === next.playbackId,
					),
				).toMatchObject({ state: "playing", gain: 0.5 });
			}),
	);
	it.scoped(
		"stop/restart completes its outgoing fade before replacing the track",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				yield* r.service.play(owner, playlist);
				const restart = yield* r.service
					.execute(
						owner,
						{ ...playlist, fade: { mode: "toggle", durationMs: 1000 } },
						"PLAY_RESTART",
					)
					.pipe(Effect.fork);
				yield* TestClock.adjust(500);
				expect(r.tracks).toHaveLength(1);
				expect(r.tracks[0]?.closed).toBe(0);
				yield* TestClock.adjust(500);
				yield* Fiber.join(restart);
				expect(r.tracks).toHaveLength(2);
				expect(r.tracks[0]?.closed).toBe(1);
				expect(r.tracks[1]?.gains).toEqual([0.5]);
			}),
	);
	it.scoped(
		"capture preempts all fading players immediately and stale completions leave speech alone",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const a = yield* r.service
					.play(owner, { ...playlist, fade: { mode: "in", durationMs: 10000 } })
					.pipe(Effect.fork);
				const b = yield* r.service
					.play(
						{ ...owner, keyCode: "2" },
						{ ...playlist, fade: { mode: "in", durationMs: 10000 } },
					)
					.pipe(Effect.fork);
				yield* TestClock.adjust(100);
				const capture = yield* r.output.acquire("capture", Effect.void);
				expect(r.tracks).toHaveLength(2);
				expect(r.tracks.every((track) => track.closed === 1)).toBe(true);
				yield* Fiber.join(a);
				yield* Fiber.join(b);
				yield* capture.release;
				let stops = 0;
				const speech = yield* r.output.acquire(
					"speech",
					Effect.sync(() => {
						stops++;
					}),
				);
				yield* TestClock.adjust(20000);
				expect(stops).toBe(0);
				expect(yield* speech.current).toBe(true);
				expect(
					(yield* r.service.snapshot()).every(
						(session) => session.state === "stopped",
					),
				).toBe(true);
				yield* speech.release;
			}),
	);
	it.scoped(
		"rejects invalid updates before touching valid playback and retains only element gain",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const session = yield* r.service.play(owner, playlist);
				for (const [volume, duration] of [
					[101, 0],
					[-1, 0],
					[50, -1],
					[50, 10001],
					[NaN, 1],
				]) {
					expect(
						yield* r.service
							.setVolume(session.playbackId, volume ?? 101, duration ?? 0)
							.pipe(Effect.either),
					).toMatchObject({
						_tag: "Left",
						left: { code: "QUAKE.AUDIO.CONFIG_INVALID" },
					});
				}
				expect(r.tracks[0]?.gains).toEqual([0.5]);
				expect(r.tracks[0]?.closed).toBe(0);
				r.unavailable.add(playlist.entries[0]?.path ?? "");
				expect(
					yield* r.service
						.play(owner, {
							...playlist,
							fade: { mode: "out", durationMs: 1000 },
						})
						.pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.FILE_UNAVAILABLE" },
				});
				expect(r.tracks[0]?.gains).toEqual([0.5]);
			}),
	);
	it.scoped(
		"dispatches operations and deactivates only the specified profile",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				yield* r.service.execute(owner, playlist, "PLAY_STOP");
				yield* r.service.execute(owner, playlist, "PLAY_ADD");
				expect(
					(yield* r.service.snapshot()).filter(
						(session) => session.state === "playing",
					),
				).toHaveLength(2);
				yield* r.service.execute(owner, playlist, "PLAY_STOP");
				expect(
					(yield* r.service.snapshot()).every(
						(session) => session.state === "stopped",
					),
				).toBe(true);
				yield* r.service.execute(owner, playlist, "PLAY_LOOP");
				expect((yield* r.service.snapshot()).at(-1)?.loopTrack).toBe(true);
				yield* r.service.execute(owner, playlist, "PLAY_NEXT");
				expect(r.tracks.at(-1)?.fileId).toBe("b");
				yield* r.service.execute(owner, playlist, "PLAY_PREV");
				expect(r.tracks.at(-1)?.fileId).toBe("a");
				const other = yield* r.service.play(
					{ ...owner, profileId: "other" },
					playlist,
				);
				yield* r.service.stopProfile(owner.profileId);
				expect(
					(yield* r.service.snapshot())
						.filter((session) => session.state === "playing")
						.map((session) => session.playbackId),
				).toEqual([other.playbackId]);
				yield* r.service.execute(owner, playlist, "STOP_ALL");
				expect(r.tracks.every((track) => track.closed === 1)).toBe(true);
			}),
	);
});
