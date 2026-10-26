import { it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Either,
	Exit,
	Fiber,
	Option,
	Schema,
	Scope,
	TestClock,
} from "effect";
import { describe, expect } from "vitest";
import { owner, playlist, rig } from "./playback-test-fixtures.js";
import {
	SoundboardDecodeFailed,
	SoundboardLoadTimeout,
} from "./soundboard-errors.js";

describe("soundboard session lifecycle with real shared output", () => {
	it.scoped(
		"forgets fully released groups instead of revisiting history at shutdown",
		() =>
			Effect.gen(function* () {
				let releases = 0;
				const r = yield* rig(
					Effect.void,
					Effect.void,
					Effect.void,
					Effect.sync(() => {
						releases++;
					}),
				);
				for (let index = 0; index < 16; index++) {
					const session = yield* r.service.play(owner, playlist);
					yield* r.service.stop(session.playbackId);
				}
				expect(releases).toBe(16);
				yield* r.service.stopAll();
				yield* r.service.close();
				expect(releases).toBe(16);
				expect(r.tracks.every((track) => track.closed === 1)).toBe(true);
			}),
	);
	it.scoped(
		"rechecks idle ownership after a queued play starts during old Stop",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				const done = yield* Deferred.make<void>();
				let count = 0;
				const r = yield* rig(
					Effect.void,
					Effect.void,
					Effect.suspend(() =>
						count++ === 0
							? Effect.void
							: Deferred.succeed(entered, undefined).pipe(
									Effect.zipRight(Deferred.await(done)),
								),
					),
				);
				const old = yield* r.service.play(owner, playlist);
				const next = yield* r.service
					.play({ ...owner, keyCode: "2" }, playlist)
					.pipe(Effect.fork);
				yield* Deferred.await(entered);
				const stopping = yield* r.service
					.stop(old.playbackId)
					.pipe(Effect.fork);
				yield* TestClock.adjust(1);
				yield* Deferred.succeed(done, undefined);
				const newer = yield* Fiber.join(next);
				yield* Fiber.join(stopping);
				expect(r.tracks[1]?.closed).toBe(0);
				expect(
					(yield* r.service.snapshot()).find(
						(s) => s.playbackId === newer.playbackId,
					)?.state,
				).toBe("playing");
			}),
	);
	it.scoped(
		"stop-all invalidates play that is still checking metadata before output acquisition",
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
				const pending = yield* r.service
					.play(owner, playlist)
					.pipe(Effect.either, Effect.fork);
				yield* Deferred.await(entered);
				const stop = yield* r.service.stopAll().pipe(Effect.fork);
				yield* TestClock.adjust(1);
				yield* Deferred.succeed(done, undefined);
				yield* Fiber.join(stop);
				expect(yield* Fiber.join(pending)).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_BUSY" },
				});
				expect(r.tracks).toHaveLength(0);
				expect(yield* r.service.snapshot()).toEqual([]);
			}),
	);
	it.scoped(
		"rejects invalid fades without changing valid playback or performing more IO",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const active = yield* r.service.play(owner, playlist);
				const before = r.inspected.length;
				expect(
					yield* r.service
						.play(owner, {
							...playlist,
							fade: { mode: "in", durationMs: 10001 },
						})
						.pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.CONFIG_INVALID" },
				});
				expect(r.inspected.length).toBe(before);
				expect(r.tracks[0]?.closed).toBe(0);
				expect((yield* r.service.snapshot())[0]?.playbackId).toBe(
					active.playbackId,
				);
			}),
	);
	it.scoped(
		"replaces only the same key and keeps PLAY_ADD instances independent",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const first = yield* r.service.play(owner, playlist);
				const other = yield* r.service.play(
					{ ...owner, keyCode: "2" },
					playlist,
				);
				const added = yield* r.service.play(owner, playlist, true);
				expect(
					new Set([first.playbackId, other.playbackId, added.playbackId]).size,
				).toBe(3);
				expect(r.tracks.map((t) => t.closed)).toEqual([0, 0, 0]);
				const replacement = yield* r.service.play(owner, playlist);
				expect(r.tracks.map((t) => t.closed)).toEqual([1, 0, 1, 0]);
				expect(
					(yield* r.service.snapshot())
						.filter((s) => s.state === "playing")
						.map((s) => s.playbackId),
				).toEqual([other.playbackId, replacement.playbackId]);
				yield* r.service.close();
				expect(r.tracks.every((t) => t.closed === 1)).toBe(true);
			}),
	);
	it.scoped(
		"rejects stale and duplicate ends and wraps the playlist indefinitely",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				let session = yield* r.service.play(owner, playlist);
				const first = session;
				for (let n = 0; n < 7; n++) {
					yield* r.service.naturalEnd(session);
					session =
						(yield* r.service.snapshot()).find(
							(s) => s.playbackId === session.playbackId,
						) ?? session;
				}
				expect(r.tracks.map((t) => t.fileId)).toEqual([
					"a",
					"b",
					"c",
					"a",
					"b",
					"c",
					"a",
					"b",
				]);
				yield* r.service.naturalEnd(first);
				expect(r.tracks).toHaveLength(8);
				yield* r.service.stop(session.playbackId);
				yield* r.service.naturalEnd(session);
				expect(r.tracks).toHaveLength(8);
			}),
	);
	it.scoped(
		"consumes the native ended signal and records decode failure instead of leaving playing state",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const session = yield* r.service.play(owner, playlist);
				const first = r.tracks[0];
				if (!first) throw new Error("missing first track");
				yield* Deferred.succeed(first.end, undefined);
				yield* TestClock.adjust(1);
				expect(r.tracks.map((t) => t.fileId)).toEqual(["a", "b"]);
				const second = r.tracks[1];
				if (!second) throw new Error("missing next track");
				yield* Deferred.fail(
					second.end,
					new SoundboardDecodeFailed(new Error("/private/secret.mp3")),
				);
				yield* TestClock.adjust(1);
				expect(
					(yield* r.service.snapshot()).find(
						(s) => s.playbackId === session.playbackId,
					),
				).toMatchObject({
					state: "failed",
					errorCode: "QUAKE.AUDIO.DECODE_FAILED",
				});
				expect(second.closed).toBe(1);
				const speech = yield* r.output.acquire("speech", Effect.void);
				yield* speech.release;
			}),
	);
	it.scoped(
		"repeats only the selected track for PLAY_LOOP and remembers the running track on replacement",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const first = yield* r.service.play(owner, playlist);
				yield* r.service.naturalEnd(first);
				const replacement = yield* r.service.play(owner, playlist, false, true);
				expect(replacement.trackIndex).toBe(1);
				yield* r.service.naturalEnd(replacement);
				expect(r.tracks.map((t) => t.fileId)).toEqual(["a", "b", "b", "b"]);
				yield* r.service.stop(replacement.playbackId);
				const resumed = yield* r.service.play(owner, playlist);
				expect(resumed).toMatchObject({ trackIndex: 1, positionMs: 0 });
			}),
	);
	it.scoped(
		"doesn't stop valid playback when explicit play targets a missing file",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const session = yield* r.service.play(owner, playlist);
				r.unavailable.add(playlist.entries[0]?.path ?? "");
				expect(
					yield* r.service.play(owner, playlist).pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.FILE_UNAVAILABLE" },
				});
				expect(r.tracks[0]?.closed).toBe(0);
				expect((yield* r.service.snapshot())[0]?.playbackId).toBe(
					session.playbackId,
				);
			}),
	);
	it.scoped(
		"skips missing tracks in one traversal and stops when none remain",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				const first = yield* r.service.play(owner, playlist);
				r.unavailable.add(playlist.entries[1]?.path ?? "");
				yield* r.service.naturalEnd(first);
				expect(r.tracks.map((t) => t.fileId)).toEqual(["a", "c"]);
				for (const entry of playlist.entries) r.unavailable.add(entry.path);
				const latest = (yield* r.service.snapshot())[0];
				if (!latest) throw new Error("missing snapshot");
				const before = r.inspected.length;
				yield* r.service.naturalEnd(latest);
				expect(r.inspected.length - before).toBe(3);
				expect((yield* r.service.snapshot())[0]).toMatchObject({
					state: "stopped",
				});
				expect(r.tracks.every((t) => t.closed === 1)).toBe(true);
			}),
	);
	it.scoped(
		"bounds readiness at ten seconds with a typed error and no orphan player",
		() =>
			Effect.gen(function* () {
				const r = yield* rig(Effect.never);
				const pending = yield* r.service
					.play(owner, playlist)
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(9999);
				expect(Option.isNone(yield* Fiber.poll(pending))).toBe(true);
				yield* TestClock.adjust(1);
				const result = yield* Fiber.join(pending);
				expect(result).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.LOAD_TIMEOUT" },
				});
				if (Either.isLeft(result))
					expect(result.left).toBeInstanceOf(SoundboardLoadTimeout);
				expect(r.tracks[0]).toMatchObject({ closed: 1, plays: 0 });
				expect((yield* r.service.snapshot())[0]).toMatchObject({
					state: "failed",
				});
			}),
	);
	it.scoped(
		"preempts every ready and pending player before capture, without auto-resume or stale stop",
		() =>
			Effect.gen(function* () {
				const latch = yield* Deferred.make<void>();
				const r = yield* rig(Deferred.await(latch));
				const pending = yield* r.service
					.play(owner, playlist)
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(1);
				const capture = yield* r.output.acquire("capture", Effect.void);
				expect(r.tracks[0]).toMatchObject({ closed: 1, plays: 0 });
				expect(yield* Fiber.join(pending)).toMatchObject({ _tag: "Left" });
				yield* Deferred.succeed(latch, undefined);
				expect(
					yield* r.service.play(owner, playlist).pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_BUSY" },
				});
				yield* capture.release;
				const a = yield* r.service.play(owner, playlist);
				yield* r.service.play({ ...owner, keyCode: "2" }, playlist);
				let speechStops = 0;
				const speech = yield* r.output.acquire(
					"speech",
					Effect.sync(() => {
						speechStops++;
					}),
				);
				expect(r.tracks.every((t) => t.closed === 1)).toBe(true);
				yield* r.service.stop(a.playbackId);
				expect(speechStops).toBe(0);
				expect(yield* speech.current).toBe(true);
				yield* speech.release;
				expect(
					(yield* r.service.snapshot()).every((s) => s.state === "stopped"),
				).toBe(true);
			}),
	);
	it.scoped(
		"cancels a pending load immediately on Stop instead of waiting for readiness",
		() =>
			Effect.gen(function* () {
				const r = yield* rig(Effect.never);
				const pending = yield* r.service
					.play(owner, playlist)
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(1);
				const loading = (yield* r.service.snapshot())[0];
				if (!loading) throw new Error("missing loading session");
				const stopping = yield* r.service
					.stop(loading.playbackId)
					.pipe(Effect.fork);
				yield* TestClock.adjust(1);
				expect(Option.isSome(yield* Fiber.poll(stopping))).toBe(true);
				expect(r.tracks[0]).toMatchObject({ closed: 1, plays: 0 });
				expect(yield* Fiber.join(pending)).toMatchObject({ _tag: "Left" });
			}),
	);
	it.scoped("detaches every snapshot and input from mutable callers", () =>
		Effect.gen(function* () {
			const r = yield* rig();
			const mutable = Schema.decodeUnknownSync(
				Schema.mutable(
					Schema.Struct({ profileId: Schema.String, keyCode: Schema.String }),
				),
			)(owner);
			const session = yield* r.service.play(mutable, playlist);
			mutable.profileId = "changed";
			Object.assign(session.owner, { profileId: "mutated-return" });
			const snapshot = yield* r.service.snapshot();
			Object.assign(snapshot[0]?.entries[0] ?? {}, {
				fileId: "changed",
				path: "/private/leak",
			});
			Object.assign(snapshot[0]?.owner ?? {}, {
				profileId: "mutated-snapshot",
			});
			const fresh = yield* r.service.snapshot();
			expect(fresh[0]?.owner).toEqual(owner);
			expect(fresh[0]?.entries[0]?.fileId).toBe("a");
			expect(JSON.stringify(fresh)).not.toMatch(/private|music|path|mutated/);
		}),
	);
	it.scoped(
		"capture waits for an already stopping native track and duplicate Stop can't release it early",
		() =>
			Effect.gen(function* () {
				const done = yield* Deferred.make<void>();
				const entered = yield* Deferred.make<void>();
				const r = yield* rig(
					Effect.void,
					Deferred.succeed(entered, undefined).pipe(
						Effect.zipRight(Deferred.await(done)),
					),
				);
				const session = yield* r.service.play(owner, playlist);
				const stopping = yield* r.service
					.stop(session.playbackId)
					.pipe(Effect.fork);
				yield* Deferred.await(entered);
				const duplicate = yield* r.service
					.stop(session.playbackId)
					.pipe(Effect.fork);
				const capture = yield* r.output
					.acquire("capture", Effect.void)
					.pipe(Effect.fork);
				yield* TestClock.adjust(1);
				expect(Option.isNone(yield* Fiber.poll(capture))).toBe(true);
				expect(Option.isNone(yield* Fiber.poll(duplicate))).toBe(true);
				yield* Deferred.succeed(done, undefined);
				yield* Fiber.join(stopping);
				yield* Fiber.join(duplicate);
				const lease = yield* Fiber.join(capture);
				expect(r.tracks[0]?.closed).toBe(1);
				expect(yield* lease.current).toBe(true);
				yield* lease.release;
			}),
	);
	it.scoped(
		"capture cancels a native-end transition that is loading the next track without deadlock",
		() =>
			Effect.gen(function* () {
				let count = 0;
				const r = yield* rig(
					Effect.suspend(() => (++count === 1 ? Effect.void : Effect.never)),
				);
				yield* r.service.play(owner, playlist);
				const first = r.tracks[0];
				if (!first) throw new Error("missing track");
				yield* Deferred.succeed(first.end, undefined);
				yield* TestClock.adjust(1);
				expect(r.tracks).toHaveLength(2);
				const capture = yield* r.output.acquire("capture", Effect.void);
				expect(r.tracks.every((t) => t.closed === 1)).toBe(true);
				expect((yield* r.service.snapshot())[0]?.state).toBe("stopped");
				yield* capture.release;
			}),
	);
	it.scoped(
		"stop-all and shutdown cancel pending readiness and shutdown refuses future work",
		() =>
			Effect.gen(function* () {
				const r = yield* rig(Effect.never);
				const pending = yield* r.service
					.play(owner, playlist)
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(1);
				yield* r.service.stopAll();
				expect(yield* Fiber.join(pending)).toMatchObject({ _tag: "Left" });
				expect(r.tracks[0]?.closed).toBe(1);
				const next = yield* r.service
					.play(owner, playlist)
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(1);
				yield* r.service.close();
				yield* r.service.close();
				expect(yield* Fiber.join(next)).toMatchObject({ _tag: "Left" });
				expect(r.tracks.every((t) => t.closed === 1)).toBe(true);
				expect(
					yield* r.service.play(owner, playlist).pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_FAILED" },
				});
			}),
	);
	it.scoped(
		"bounds active sessions and terminal retention while permitting replacement at capacity",
		() =>
			Effect.gen(function* () {
				const r = yield* rig();
				for (let n = 0; n < 128; n++)
					yield* r.service.play({ ...owner, keyCode: String(n) }, playlist);
				expect(
					yield* r.service
						.play({ ...owner, keyCode: "overflow" }, playlist)
						.pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.CONFIG_INVALID" },
				});
				const replacement = yield* r.service.play(owner, playlist);
				expect(replacement.state).toBe("playing");
				yield* r.service.stopAll();
				for (let n = 0; n < 130; n++) {
					const session = yield* r.service.play(owner, playlist);
					yield* r.service.stop(session.playbackId);
				}
				expect(yield* r.service.snapshot()).toHaveLength(256);
				expect(r.tracks.every((t) => t.closed === 1)).toBe(true);
			}),
	);
	it.scoped(
		"a stalled finalizer makes capture fail closed at two seconds without granting new output",
		() =>
			Effect.gen(function* () {
				const done = yield* Deferred.make<void>();
				const r = yield* rig(Effect.void, Deferred.await(done));
				yield* r.service.play(owner, playlist);
				const capture = yield* r.output
					.acquire("capture", Effect.void)
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(2000);
				expect(yield* Fiber.join(capture)).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_FAILED" },
				});
				expect(
					yield* r.service.play(owner, playlist).pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_FAILED" },
				});
				yield* Deferred.succeed(done, undefined);
				yield* r.service.close();
				expect(r.tracks[0]?.closed).toBe(1);
			}),
	);
	it.effect(
		"reports native teardown defects as failed observations and prevents replacement output",
		() =>
			Effect.gen(function* () {
				const scope = yield* Scope.make();
				const original = new Error("private native teardown refusal");
				const r = yield* rig(Effect.void, Effect.die(original)).pipe(
					Effect.provideService(Scope.Scope, scope),
				);
				const session = yield* r.service.play(owner, playlist);
				expect(
					Exit.isFailure(
						yield* r.service.stop(session.playbackId).pipe(Effect.exit),
					),
				).toBe(true);
				expect((yield* r.service.snapshot())[0]).toMatchObject({
					state: "failed",
					errorCode: "QUAKE.AUDIO.OUTPUT_FAILED",
				});
				expect(
					yield* r.output.acquire("capture", Effect.void).pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_FAILED" },
				});
				expect(
					Exit.isFailure(
						yield* Scope.close(scope, Exit.void).pipe(Effect.exit),
					),
				).toBe(true);
			}),
	);
	it.effect(
		"natural advancement publishes native teardown failure and fails output closed",
		() =>
			Effect.gen(function* () {
				const scope = yield* Scope.make();
				const r = yield* rig(
					Effect.void,
					Effect.die(new Error("private natural teardown")),
				).pipe(Effect.provideService(Scope.Scope, scope));
				yield* r.service.play(owner, playlist);
				const first = r.tracks[0];
				if (!first) return yield* Effect.die("missing player");
				yield* Deferred.succeed(first.end, undefined);
				yield* TestClock.adjust(1);
				const snapshot = yield* r.service.snapshot();
				const capture = yield* r.output
					.acquire("capture", Effect.void)
					.pipe(Effect.either);
				yield* Scope.close(scope, Exit.void).pipe(Effect.exit);
				expect(snapshot[0]).toMatchObject({
					state: "failed",
					errorCode: "QUAKE.AUDIO.OUTPUT_FAILED",
				});
				expect(capture).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_FAILED" },
				});
				expect(r.tracks).toHaveLength(1);
			}),
	);
	for (const kind of ["decode", "timeout"] as const) {
		it.scoped(
			`a queued different key survives ${kind} idle-group release`,
			() =>
				Effect.gen(function* () {
					const entered = yield* Deferred.make<void>();
					const done = yield* Deferred.make<void>();
					let first = true;
					const r = yield* rig(
						Effect.suspend(() => {
							if (!first) return Effect.void;
							first = false;
							return Deferred.succeed(entered, undefined).pipe(
								Effect.zipRight(
									kind === "timeout"
										? Effect.never
										: Deferred.await(done).pipe(
												Effect.zipRight(
													Effect.fail(new SoundboardDecodeFailed()),
												),
											),
								),
							);
						}),
					);
					const failing = yield* r.service
						.play(owner, playlist)
						.pipe(Effect.either, Effect.fork);
					yield* Deferred.await(entered);
					const waiting = yield* r.service
						.play({ ...owner, keyCode: "2" }, playlist)
						.pipe(Effect.either, Effect.fork);
					yield* TestClock.adjust(1);
					if (kind === "timeout") yield* TestClock.adjust(10_000);
					else yield* Deferred.succeed(done, undefined);
					expect(yield* Fiber.join(failing)).toMatchObject({
						_tag: "Left",
						left: {
							code:
								kind === "timeout"
									? "QUAKE.AUDIO.LOAD_TIMEOUT"
									: "QUAKE.AUDIO.DECODE_FAILED",
						},
					});
					expect(yield* Fiber.join(waiting)).toMatchObject({
						_tag: "Right",
						right: { state: "playing", owner: { keyCode: "2" } },
					});
					expect(r.tracks.map((track) => track.fileId)).toEqual(["a", "a"]);
				}),
		);
	}

	it.scoped("duplicate shutdown waits for pending native teardown", () =>
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
			const first = yield* r.service.close().pipe(Effect.fork);
			yield* Deferred.await(entered);
			const second = yield* r.service.close().pipe(Effect.fork);
			yield* TestClock.adjust(1);
			expect(Option.isNone(yield* Fiber.poll(second))).toBe(true);
			yield* Deferred.succeed(done, undefined);
			yield* Fiber.join(first);
			yield* Fiber.join(second);
			expect(r.tracks[0]?.closed).toBe(1);
		}),
	);
});
