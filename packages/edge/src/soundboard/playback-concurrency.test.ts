import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option, TestClock } from "effect";
import { describe, expect } from "vitest";
import { owner, playlist, rig } from "./playback-test-fixtures.js";

describe("soundboard command concurrency", () => {
	it.scoped(
		"profile deactivation cancels a start awaiting output delivery",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				const done = yield* Deferred.make<void>();
				const r = yield* rig(
					Effect.void,
					Effect.void,
					Effect.void,
					Effect.void,
					() => Effect.void,
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
				const speech = yield* r.output.acquire("speech", Effect.void);
				yield* speech.release;
			}),
	);
	for (const stopAll of [false, true]) {
		it.scoped(
			`${stopAll ? "Stop All" : "profile deactivation"} cancels replacement awaiting old player cleanup`,
			() =>
				Effect.gen(function* () {
					const entered = yield* Deferred.make<void>();
					const done = yield* Deferred.make<void>();
					const r = yield* rig(
						Effect.void,
						Deferred.succeed(entered, undefined).pipe(
							Effect.zipRight(Deferred.await(done)),
						),
					);
					yield* r.service.play(owner, playlist);
					const replacement = yield* r.service
						.play(owner, playlist)
						.pipe(Effect.either, Effect.fork);
					yield* Deferred.await(entered);
					const stop = yield* (
						stopAll
							? r.service.stopAll()
							: r.service.stopProfile(owner.profileId)
					).pipe(Effect.fork);
					yield* TestClock.adjust(1);
					yield* Deferred.succeed(done, undefined);
					const outcome = yield* Fiber.join(replacement);
					yield* Fiber.join(stop);
					expect(outcome).toMatchObject({
						_tag: "Left",
						left: { code: "QUAKE.AUDIO.OUTPUT_BUSY" },
					});
					expect(r.tracks).toHaveLength(1);
					expect(r.tracks[0]?.closed).toBe(1);
				}),
		);
	}
	for (const direction of ["next", "previous"] as const) {
		it.scoped(
			`natural end during ${direction} fade respects the explicit selection`,
			() =>
				Effect.gen(function* () {
					const r = yield* rig();
					yield* r.service.play(owner, playlist);
					const navigation = yield* r.service
						.execute(
							owner,
							{
								...playlist,
								fade: { mode: "out", durationMs: 1000 },
							},
							direction === "next" ? "PLAY_NEXT" : "PLAY_PREV",
						)
						.pipe(Effect.fork);
					yield* TestClock.adjust(200);
					const track = r.tracks[0];
					if (!track) return yield* Effect.die("missing player");
					yield* Deferred.succeed(track.end, undefined);
					yield* TestClock.adjust(1);
					const beforeFade = r.tracks.map((entry) => entry.fileId);
					yield* TestClock.adjust(799);
					yield* Fiber.join(navigation);
					expect(beforeFade).toEqual(["a"]);
					expect(r.tracks.map((entry) => entry.fileId)).toEqual([
						"a",
						direction === "next" ? "b" : "c",
					]);
				}),
		);
	}
	it.scoped(
		"interrupting navigation after natural end closes its player without restarting",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				yield* r.service.play(owner, playlist);
				const navigation = yield* r.service
					.execute(
						owner,
						{
							...playlist,
							fade: { mode: "out", durationMs: 1000 },
						},
						"PLAY_PREV",
					)
					.pipe(Effect.fork);
				yield* TestClock.adjust(200);
				const track = r.tracks[0];
				if (!track) return yield* Effect.die("missing player");
				yield* Deferred.succeed(track.end, undefined);
				yield* TestClock.adjust(1);
				yield* Fiber.interrupt(navigation);
				expect(r.tracks.map((entry) => entry.fileId)).toEqual(["a"]);
				expect(track.closed).toBe(1);
				expect((yield* r.service.snapshot())[0]?.state).toBe("stopped");
			}),
	);
	it.scoped("a newer scan wins even if an older scan finishes last", () =>
		Effect.gen(function* () {
			const entered = yield* Deferred.make<void>();
			const done = yield* Deferred.make<void>();
			let delayed = false;
			const r = yield* rig(
				Effect.void,
				Effect.void,
				Effect.suspend(() =>
					delayed
						? Deferred.succeed(entered, undefined).pipe(
								Effect.zipRight(Deferred.await(done)),
							)
						: Effect.void,
				),
			);
			const session = yield* r.service.play(owner, playlist);
			delayed = true;
			const old = yield* r.service.rescan(session.playbackId).pipe(Effect.fork);
			yield* Deferred.await(entered);
			delayed = false;
			yield* r.service.rescan(session.playbackId);
			r.unavailable.add(playlist.entries[0]?.path ?? "");
			yield* Deferred.succeed(done, undefined);
			yield* Fiber.join(old);
			expect((yield* r.service.snapshot())[0]?.entries[0]?.status).toBe(
				"available",
			);
		}),
	);
	it.scoped(
		"slow rescan leaves other keys responsive and cannot overwrite a stopped snapshot",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				const done = yield* Deferred.make<void>();
				let scanning = false;
				const r = yield* rig(
					Effect.void,
					Effect.void,
					Effect.suspend(() =>
						scanning
							? Deferred.succeed(entered, undefined).pipe(
									Effect.zipRight(Deferred.await(done)),
								)
							: Effect.void,
					),
				);
				const first = yield* r.service.play(owner, playlist);
				const second = yield* r.service.play(
					{ ...owner, keyCode: "2" },
					playlist,
				);
				scanning = true;
				const scan = yield* r.service
					.rescan(first.playbackId)
					.pipe(Effect.fork);
				yield* Deferred.await(entered);
				const pause = yield* r.service
					.pause(second.playbackId)
					.pipe(Effect.fork);
				yield* TestClock.adjust(1);
				const pauseResult = yield* Fiber.poll(pause);
				const stop = yield* r.service.stop(first.playbackId).pipe(Effect.fork);
				yield* TestClock.adjust(1);
				r.unavailable.add(playlist.entries[0]?.path ?? "");
				yield* Deferred.succeed(done, undefined);
				yield* Fiber.join(scan);
				yield* Fiber.join(pause);
				yield* Fiber.join(stop);
				expect(Option.isSome(pauseResult)).toBe(true);
				expect(
					(yield* r.service.snapshot()).find(
						(s) => s.playbackId === first.playbackId,
					),
				).toMatchObject({
					state: "stopped",
					entries: [
						{ status: "available" },
						{ status: "available" },
						{ status: "available" },
					],
				});
			}),
	);
});
