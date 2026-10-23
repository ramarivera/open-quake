import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import {
	emptyKnobSlot,
	type KnobDispatchCommand,
	KnobService,
} from "../../src/knob/index.js";
import {
	harness,
	knob,
	nextPage,
	press,
	release,
	rotate,
	session,
	snapshot,
} from "./fixtures.js";

const hold = { _tag: "HoldStart", session, pressId: press.pressId } as const;
const configured = () => snapshot(knob([nextPage, emptyKnobSlot(), nextPage]));
const failures = [
	{
		name: "rejected",
		tag: "KnobDispatchFailed",
		read: () => Promise.reject(new Error("temporary snapshot failure")),
	},
	{
		name: "unavailable",
		tag: "KnobCapabilityUnavailable",
		read: () => Promise.resolve(undefined),
	},
	{
		name: "invalid",
		tag: "InvalidKnobConfig",
		read: () => Promise.resolve({ session, knob: { wrong: true } }),
	},
] as const;

describe("knob gesture recovery", () => {
	for (const failure of failures) {
		it.effect(`retires a release after ${failure.name} snapshot reads`, () =>
			Effect.gen(function* () {
				let failReads = false;
				const h = harness(configured(), {
					readSnapshot: () =>
						failReads ? failure.read() : Promise.resolve(configured()),
				});
				yield* Effect.gen(function* () {
					yield* KnobService.dispatch(press);
					failReads = true;
					expect(
						yield* Effect.either(KnobService.dispatch(release)),
					).toMatchObject({ _tag: "Left", left: { _tag: failure.tag } });
					failReads = false;
					const next = { ...press, pressId: "press-2" };
					yield* KnobService.dispatch(next);
					yield* KnobService.dispatch(next);
					expect(
						yield* KnobService.dispatch({ ...release, pressId: next.pressId }),
					).toEqual({ dispatched: 1, ignored: 0 });
					yield* KnobService.dispatch({ ...release, pressId: next.pressId });
					// A failed terminal event cannot be replayed after recovery.
					yield* KnobService.dispatch(press);
					yield* KnobService.dispatch(release);
				}).pipe(Effect.provide(h.layer));
				expect(h.commands).toHaveLength(1);
				expect(h.commands[0]).toMatchObject({
					session,
					route: "center",
					activation: "press",
				});
			}),
		);
		it.effect(`consumes a hold before ${failure.name} snapshot reads`, () =>
			Effect.gen(function* () {
				let failReads = false;
				const h = harness(configured(), {
					readSnapshot: () =>
						failReads ? failure.read() : Promise.resolve(configured()),
				});
				yield* Effect.gen(function* () {
					yield* KnobService.dispatch(press);
					failReads = true;
					expect(
						yield* Effect.either(KnobService.dispatch(hold)),
					).toMatchObject({ _tag: "Left", left: { _tag: failure.tag } });
					failReads = false;
					yield* KnobService.dispatch(press);
					expect(yield* KnobService.dispatch(hold)).toEqual({
						dispatched: 0,
						ignored: 1,
					});
					yield* KnobService.dispatch(release);
					expect(h.commands).toEqual([]);
					yield* KnobService.dispatch({ ...press, pressId: "press-2" });
					yield* KnobService.dispatch({ ...release, pressId: "press-2" });
				}).pipe(Effect.provide(h.layer));
				expect(h.commands).toHaveLength(1);
			}),
		);
		it.effect(
			`invalidates disconnect despite ${failure.name} snapshot reads`,
			() =>
				Effect.gen(function* () {
					let failReads = false;
					let reads = 0;
					const h = harness(configured(), {
						readSnapshot: () => {
							reads++;
							return failReads ? failure.read() : Promise.resolve(configured());
						},
					});
					yield* Effect.gen(function* () {
						yield* KnobService.dispatch(press);
						failReads = true;
						expect(
							yield* KnobService.dispatch({ _tag: "Disconnect", session }),
						).toEqual({ dispatched: 0, ignored: 1 });
						expect(reads).toBe(1);
						failReads = false;
						for (const event of [rotate(), hold, release, press])
							expect(
								yield* Effect.either(KnobService.dispatch(event)),
							).toMatchObject({
								_tag: "Left",
								left: { _tag: "KnobSessionStale" },
							});
						expect(reads).toBe(1);
					}).pipe(Effect.provide(h.layer));
					expect(h.commands).toEqual([]);
				}),
		);
		it.effect(
			`keeps another gesture pending after ${failure.name} release reads`,
			() =>
				Effect.gen(function* () {
					let failReads = false;
					const h = harness(configured(), {
						readSnapshot: () =>
							failReads ? failure.read() : Promise.resolve(configured()),
					});
					yield* Effect.gen(function* () {
						yield* KnobService.dispatch(press);
						failReads = true;
						expect(
							yield* Effect.either(
								KnobService.dispatch({ ...release, pressId: "other" }),
							),
						).toMatchObject({ _tag: "Left", left: { _tag: failure.tag } });
						failReads = false;
						yield* KnobService.dispatch(release);
					}).pipe(Effect.provide(h.layer));
					expect(h.commands).toHaveLength(1);
				}),
		);
	}

	for (const failFirst of [false, true]) {
		it.effect(
			`does not replay older completed gestures after ${failFirst ? "failed" : "successful"} dispatch`,
			() =>
				Effect.gen(function* () {
					const attempted: KnobDispatchCommand[] = [];
					const h = harness(configured(), {
						dispatch: (command) => {
							attempted.push(command);
							return failFirst && attempted.length === 1
								? Promise.reject(new Error("temporary dispatch failure"))
								: Promise.resolve();
						},
					});
					yield* Effect.gen(function* () {
						yield* KnobService.dispatch(press);
						const first = yield* Effect.either(KnobService.dispatch(release));
						expect(first._tag).toBe(failFirst ? "Left" : "Right");
						yield* KnobService.dispatch({ ...press, pressId: "press-2" });
						yield* KnobService.dispatch({ ...release, pressId: "press-2" });
						// Replay A after B has completed, including duplicate hold input.
						yield* KnobService.dispatch(press);
						yield* KnobService.dispatch(release);
						yield* KnobService.dispatch(hold);
					}).pipe(Effect.provide(h.layer));
					expect(attempted).toHaveLength(2);
				}),
		);
	}
	it.effect(
		"retires an interrupted release before the snapshot read completes",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				const resume = yield* Deferred.make<ReturnType<typeof configured>>();
				let pauseReads = false;
				const h = harness(configured(), {
					readSnapshot: () =>
						pauseReads
							? Effect.runPromise(
									Deferred.succeed(entered, undefined).pipe(
										Effect.zipRight(Deferred.await(resume)),
									),
								)
							: Promise.resolve(configured()),
				});
				yield* Effect.gen(function* () {
					yield* KnobService.dispatch(press);
					pauseReads = true;
					const pending = yield* Effect.fork(KnobService.dispatch(release));
					yield* Deferred.await(entered);
					yield* Fiber.interrupt(pending);
					yield* Deferred.succeed(resume, configured());
					pauseReads = false;
					yield* KnobService.dispatch({ ...press, pressId: "press-2" });
					yield* KnobService.dispatch({ ...release, pressId: "press-2" });
					yield* KnobService.dispatch(press);
					yield* KnobService.dispatch(release);
				}).pipe(Effect.provide(h.layer));
				expect(h.commands).toHaveLength(1);
			}),
	);
	it.effect(
		"late old-session disconnects preserve a newer gesture and its invalidation",
		() =>
			Effect.gen(function* () {
				const newer = { ...session, sessionId: "connection-2" };
				const h = harness(configured());
				yield* Effect.gen(function* () {
					yield* KnobService.dispatch({ _tag: "Disconnect", session });
					h.publish({ ...configured(), session: newer });
					yield* KnobService.dispatch({ ...press, session: newer });
					yield* KnobService.dispatch({ _tag: "Disconnect", session });
					expect(
						yield* KnobService.dispatch({ ...release, session: newer }),
					).toEqual({ dispatched: 1, ignored: 0 });
					yield* KnobService.dispatch({ _tag: "Disconnect", session: newer });
					yield* KnobService.dispatch({ _tag: "Disconnect", session });
					expect(
						yield* Effect.either(
							KnobService.dispatch({ ...rotate(), session: newer }),
						),
					).toMatchObject({
						_tag: "Left",
						left: { _tag: "KnobSessionStale" },
					});
				}).pipe(Effect.provide(h.layer));
				expect(h.commands).toHaveLength(1);
				expect(h.commands[0]?.session).toEqual(newer);
			}),
	);
	it.effect(
		"late old-session release and hold events preserve the current gesture",
		() =>
			Effect.gen(function* () {
				const newer = {
					...session,
					sessionId: "selection-2",
					profileId: "profile-b",
				};
				const h = harness(configured());
				yield* Effect.gen(function* () {
					yield* KnobService.dispatch(press);
					h.publish({ ...configured(), session: newer });
					yield* KnobService.dispatch({ ...press, session: newer });
					for (const event of [release, hold])
						expect(
							yield* Effect.either(KnobService.dispatch(event)),
						).toMatchObject({
							_tag: "Left",
							left: { _tag: "KnobSessionStale" },
						});
					yield* KnobService.dispatch({ ...release, session: newer });
				}).pipe(Effect.provide(h.layer));
				expect(h.commands).toHaveLength(1);
				expect(h.commands[0]?.session).toEqual(newer);
			}),
	);
	it.effect(
		"permits the same press ID in a new session after an earlier completion",
		() =>
			Effect.gen(function* () {
				const newer = { ...session, sessionId: "connection-2" };
				const h = harness(configured());
				yield* Effect.gen(function* () {
					yield* KnobService.dispatch(press);
					yield* KnobService.dispatch(release);
					h.publish({ ...configured(), session: newer });
					yield* KnobService.dispatch({ ...press, session: newer });
					yield* KnobService.dispatch({ ...release, session: newer });
				}).pipe(Effect.provide(h.layer));
				expect(h.commands.map((command) => command.session)).toEqual([
					session,
					newer,
				]);
			}),
	);
});
