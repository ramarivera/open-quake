import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Either,
	Fiber,
	FastCheck as fc,
	Schema,
} from "effect";
import {
	emptyKnobSlot,
	InvalidKnobConfig,
	KnobCapabilityUnavailable,
	type KnobDispatchCommand,
	KnobDispatchFailed,
	KnobErrors,
	KnobRouteIncomplete,
	KnobService,
	KnobSessionStale,
} from "../../src/knob/index.js";
import {
	brightness,
	harness,
	key,
	knob,
	nextPage,
	press,
	previousPage,
	release,
	rotate,
	session,
	snapshot,
	voice,
} from "./fixtures.js";

const run = (h: ReturnType<typeof harness>, event: unknown) =>
	KnobService.dispatch(event).pipe(Effect.provide(h.layer));
const hold = { _tag: "HoldStart", session, pressId: press.pressId } as const;

describe("knob conductor dispatch consumer", () => {
	it.effect.prop(
		"routes each focused detent once, using the selected directional action",
		[fc.integer({ min: 1, max: 15 }), fc.boolean()],
		([detents, clockwise]) =>
			Effect.gen(function* () {
				const h = harness({
					...snapshot(),
					focused: {
						keyCode: "1,1",
						visible: true,
						supportKnob: true,
						directions: [key("ctrl+a"), key("ctrl+b")],
					},
				});
				const result = yield* run(
					h,
					rotate(detents, clockwise ? "clockwise" : "counterclockwise"),
				);
				expect(result).toEqual({ dispatched: detents, ignored: 0 });
				expect(h.readCount()).toBe(detents);
				expect(h.commands).toHaveLength(detents);
				for (const command of h.commands)
					expect(command).toMatchObject({
						route: "focused",
						session,
						assignment: key(clockwise ? "ctrl+b" : "ctrl+a"),
					});
				expect(
					h.commands.some((c) => c.assignment.config.type === "nextPage"),
				).toBe(false);
			}),
	);
	it.effect(
		"ignores hidden, unsupported, or invalid focus and chooses only the directional profile slot",
		() =>
			Effect.gen(function* () {
				for (const focused of [
					{
						keyCode: "1,1",
						visible: false,
						supportKnob: true,
						directions: [key("ctrl+a"), key("ctrl+b")],
					},
					{
						keyCode: "1,1",
						visible: true,
						supportKnob: false,
						directions: [key("ctrl+a"), key("ctrl+b")],
					},
					{
						keyCode: "1,1",
						visible: true,
						supportKnob: true,
						directions: [key("invalid"), key("ctrl+b")],
					},
				]) {
					const h = harness({
						...snapshot(knob([brightness, previousPage, nextPage])),
						focused,
					});
					yield* run(h, rotate());
					expect(h.commands).toHaveLength(1);
					expect(h.commands[0]).toMatchObject({
						route: "right",
						assignment: nextPage,
					});
				}
			}),
	);
	it.effect(
		"falls back to a rotation-capable center only when the directional slot is empty",
		() =>
			Effect.gen(function* () {
				const h = harness(
					snapshot(knob([brightness, previousPage, emptyKnobSlot()])),
				);
				yield* Effect.gen(function* () {
					yield* KnobService.dispatch(rotate());
					yield* KnobService.dispatch(rotate(1, "counterclockwise"));
				}).pipe(Effect.provide(h.layer));
				expect(
					h.commands.map((c) => [c.route, c.assignment.config.type]),
				).toEqual([
					["center", "panelBrightness"],
					["left", "previousPage"],
				]);
			}),
	);
	it.effect("empty slots and voice-only centers do nothing on rotation", () =>
		Effect.gen(function* () {
			for (const center of [emptyKnobSlot(), voice()]) {
				const h = harness(
					snapshot(knob([center, emptyKnobSlot(), emptyKnobSlot()])),
				);
				expect(yield* run(h, rotate(3))).toEqual({ dispatched: 0, ignored: 3 });
				expect(h.commands).toEqual([]);
			}
		}),
	);
	it.effect(
		"a selected unavailable route fails without falling through to another action",
		() =>
			Effect.gen(function* () {
				const original = KnobCapabilityUnavailable.fromCause(
					new Error("private runtime"),
				);
				const attempted: KnobDispatchCommand[] = [];
				const h = harness(
					snapshot(knob([brightness, emptyKnobSlot(), nextPage])),
					{
						dispatch: (command) => {
							attempted.push(command);
							return Promise.reject(original);
						},
					},
				);
				const result = yield* Effect.either(run(h, rotate(3)));
				expect(Either.isLeft(result)).toBe(true);
				if (Either.isLeft(result)) {
					expect(result.left).toBeInstanceOf(KnobCapabilityUnavailable);
					expect(result.left.originalCause).toBe(original.originalCause);
					expect(result.left.diagnosticCause).toBe(original.diagnosticCause);
				}
				expect(attempted.map((c) => c.route)).toEqual(["right"]);
				expect(h.commands).toEqual([]);
			}),
	);
	it.effect(
		"rechecks committed ownership on every detent and stops the remainder after a profile switch",
		() =>
			Effect.gen(function* () {
				const executed: KnobDispatchCommand[] = [];
				const h = harness(snapshot(), {
					dispatch: (command) => {
						executed.push(command);
						h.publish({
							...snapshot(),
							session: {
								...session,
								sessionId: "selection-2",
								profileId: "profile-b",
							},
						});
						return Promise.resolve();
					},
				});
				const result = yield* Effect.either(run(h, rotate(4)));
				expect(Either.isLeft(result) && result.left).toBeInstanceOf(
					KnobSessionStale,
				);
				expect(executed).toHaveLength(1);
				expect(executed[0]?.session.profileId).toBe("profile-a");
				expect(h.readCount()).toBe(2);
			}),
	);
	it.effect(
		"the dispatch consumer rejects a selection change between snapshot read and IO",
		() =>
			Effect.gen(function* () {
				let valid = true;
				let writes = 0;
				const h = harness(snapshot(), {
					readSnapshot: () => {
						valid = false;
						return Promise.resolve(snapshot());
					},
					dispatch: () => {
						if (!valid) return Promise.reject(KnobSessionStale.fromCause());
						writes++;
						return Promise.resolve();
					},
				});
				const result = yield* Effect.either(run(h, rotate()));
				expect(Either.isLeft(result) && result.left).toBeInstanceOf(
					KnobSessionStale,
				);
				expect(writes).toBe(0);
			}),
	);
	it.effect(
		"new profile snapshots do not inherit focused actions or knob data",
		() =>
			Effect.gen(function* () {
				const h = harness({
					...snapshot(),
					focused: {
						keyCode: "1,1",
						visible: true,
						supportKnob: true,
						directions: [key("ctrl+a"), key("ctrl+b")],
					},
				});
				const newSession = {
					...session,
					sessionId: "selection-2",
					profileId: "profile-b",
				};
				yield* Effect.gen(function* () {
					yield* KnobService.dispatch(rotate());
					h.publish({ session: newSession });
					expect(
						yield* Effect.either(KnobService.dispatch(rotate())),
					).toMatchObject({ _tag: "Left", left: { _tag: "KnobSessionStale" } });
					expect(
						yield* KnobService.dispatch({ ...rotate(), session: newSession }),
					).toEqual({ dispatched: 0, ignored: 1 });
				}).pipe(Effect.provide(h.layer));
				expect(h.commands).toHaveLength(1);
			}),
	);
	it.effect(
		"waits for a classified short release and never executes left/right on press",
		() =>
			Effect.gen(function* () {
				const h = harness(
					snapshot(knob([key("ctrl+c"), previousPage, nextPage])),
				);
				yield* Effect.gen(function* () {
					yield* KnobService.dispatch(press);
					yield* KnobService.dispatch(press);
					expect(h.commands).toEqual([]);
					yield* KnobService.dispatch(release);
					yield* KnobService.dispatch(press);
					yield* KnobService.dispatch(release);
				}).pipe(Effect.provide(h.layer));
				expect(h.commands).toHaveLength(1);
				expect(h.commands[0]).toMatchObject({
					route: "center",
					activation: "press",
					assignment: key("ctrl+c"),
				});
			}),
	);
	it.effect(
		"pressing a brightness center and unmatched or cancelled releases perform no IO",
		() =>
			Effect.gen(function* () {
				const h = harness(snapshot(knob([brightness, previousPage, nextPage])));
				yield* Effect.gen(function* () {
					yield* KnobService.dispatch(release);
					yield* KnobService.dispatch(press);
					yield* KnobService.dispatch({ ...release, pressId: "other" });
					yield* KnobService.dispatch(release);
					yield* KnobService.dispatch({ ...press, pressId: "p2" });
					yield* KnobService.dispatch({
						...release,
						pressId: "p2",
						classification: "cancelled",
					});
				}).pipe(Effect.provide(h.layer));
				expect(h.commands).toEqual([]);
			}),
	);
	it.effect(
		"consumes unavailable holds once so a later short classification cannot fire a press",
		() =>
			Effect.gen(function* () {
				const h = harness(
					snapshot(knob([key("ctrl+c"), emptyKnobSlot(), emptyKnobSlot()])),
				);
				yield* Effect.gen(function* () {
					yield* KnobService.dispatch(press);
					expect(
						yield* Effect.either(KnobService.dispatch(hold)),
					).toMatchObject({
						_tag: "Left",
						left: { _tag: "KnobCapabilityUnavailable" },
					});
					yield* KnobService.dispatch(hold);
					yield* KnobService.dispatch(press);
					yield* KnobService.dispatch(release);
				}).pipe(Effect.provide(h.layer));
				expect(h.commands).toEqual([]);
			}),
	);
	it.effect(
		"distinguishes incomplete direct routes without starting voice",
		() =>
			Effect.gen(function* () {
				for (const [model, tag] of [
					["", "KnobRouteIncomplete"],
					["model", "KnobCapabilityUnavailable"],
				] as const) {
					const h = harness(
						snapshot(knob([voice(model), emptyKnobSlot(), emptyKnobSlot()])),
					);
					yield* Effect.gen(function* () {
						yield* KnobService.dispatch(press);
						expect(
							yield* Effect.either(KnobService.dispatch(hold)),
						).toMatchObject({ _tag: "Left", left: { _tag: tag } });
						yield* KnobService.dispatch({ ...release, classification: "held" });
					}).pipe(Effect.provide(h.layer));
					expect(h.commands).toEqual([]);
				}
			}),
	);
	it.effect(
		"rejects old-session input after disconnect, profile change, revision change, or reconnect",
		() =>
			Effect.gen(function* () {
				for (const change of [
					"disconnect",
					"profile",
					"revision",
					"reconnect",
				]) {
					const h = harness(
						snapshot(knob([nextPage, emptyKnobSlot(), nextPage])),
					);
					yield* Effect.gen(function* () {
						yield* KnobService.dispatch(press);
						if (change === "disconnect")
							yield* KnobService.dispatch({ _tag: "Disconnect", session });
						else
							h.publish({
								...snapshot(),
								session: {
									...session,
									...(change === "profile"
										? { profileId: "profile-b" }
										: change === "revision"
											? { revision: 5 }
											: { sessionId: "connection-2" }),
								},
							});
						for (const event of [release, rotate(), hold])
							expect(
								yield* Effect.either(KnobService.dispatch(event)),
							).toMatchObject({
								_tag: "Left",
								left: { _tag: "KnobSessionStale" },
							});
					}).pipe(Effect.provide(h.layer));
					expect(h.commands).toEqual([]);
				}
			}),
	);
	it.effect("does not replay a failed side effect on duplicate release", () =>
		Effect.gen(function* () {
			let attempts = 0;
			const h = harness(
				snapshot(knob([nextPage, emptyKnobSlot(), emptyKnobSlot()])),
				{
					dispatch: () => {
						attempts++;
						return Promise.reject(new Error("failed"));
					},
				},
			);
			yield* Effect.gen(function* () {
				yield* KnobService.dispatch(press);
				yield* Effect.either(KnobService.dispatch(release));
				yield* KnobService.dispatch(release);
			}).pipe(Effect.provide(h.layer));
			expect(attempts).toBe(1);
		}),
	);
	it.effect(
		"fails closed without injected ports and rejects invalid events/snapshots before dispatch",
		() =>
			Effect.gen(function* () {
				expect(
					yield* Effect.either(
						KnobService.dispatch(rotate()).pipe(
							Effect.provide(KnobService.Default),
						),
					),
				).toMatchObject({
					_tag: "Left",
					left: { _tag: "KnobCapabilityUnavailable" },
				});
				const invalidEvent = harness();
				expect(
					yield* Effect.either(run(invalidEvent, rotate(0))),
				).toMatchObject({ _tag: "Left", left: { _tag: "InvalidKnobConfig" } });
				expect(invalidEvent.readCount()).toBe(0);
				const invalidSnapshot = harness({
					session,
					knob: { wrong: "private" },
				});
				expect(
					yield* Effect.either(run(invalidSnapshot, rotate())),
				).toMatchObject({ _tag: "Left", left: { _tag: "InvalidKnobConfig" } });
				expect(invalidSnapshot.commands).toEqual([]);
				const invalidFunction = harness(
					snapshot(
						knob([emptyKnobSlot(), emptyKnobSlot(), key("unsupported")]),
					),
				);
				expect(
					yield* Effect.either(run(invalidFunction, rotate())),
				).toMatchObject({ _tag: "Left", left: { _tag: "InvalidKnobConfig" } });
				expect(invalidFunction.commands).toEqual([]);
			}),
	);
	it.effect("keeps identical press IDs on separate devices independent", () =>
		Effect.gen(function* () {
			const second = { ...session, deviceId: "device-b" };
			const h = harness(
				snapshot(knob([nextPage, emptyKnobSlot(), emptyKnobSlot()])),
				{
					readSnapshot: (deviceId) =>
						Promise.resolve({
							session: deviceId === session.deviceId ? session : second,
							knob: knob([nextPage, emptyKnobSlot(), emptyKnobSlot()]),
						}),
				},
			);
			yield* Effect.gen(function* () {
				yield* KnobService.dispatch(press);
				yield* KnobService.dispatch({ ...press, session: second });
				yield* KnobService.dispatch({ ...release, session: second });
				yield* KnobService.dispatch(release);
			}).pipe(Effect.provide(h.layer));
			expect(h.commands.map((c) => c.session.deviceId)).toEqual([
				"device-b",
				"device-a",
			]);
		}),
	);
	it.effect(
		"serializes concurrent duplicate releases around the actual dispatch callback",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				const finish = yield* Deferred.make<void>();
				let calls = 0;
				const h = harness(
					snapshot(knob([nextPage, emptyKnobSlot(), emptyKnobSlot()])),
					{
						dispatch: () =>
							Effect.runPromise(
								Effect.gen(function* () {
									calls++;
									yield* Deferred.succeed(entered, undefined);
									yield* Deferred.await(finish);
								}),
							),
					},
				);
				yield* Effect.gen(function* () {
					yield* KnobService.dispatch(press);
					const first = yield* Effect.fork(KnobService.dispatch(release));
					yield* Deferred.await(entered);
					const second = yield* Effect.fork(KnobService.dispatch(release));
					yield* Deferred.succeed(finish, undefined);
					yield* Fiber.join(first);
					yield* Fiber.join(second);
				}).pipe(Effect.provide(h.layer));
				expect(calls).toBe(1);
			}),
	);
});

describe("knob catalog errors at dependency boundaries", () => {
	it.effect(
		"retains exact read/dispatch causes while scrubbing messages, values, paths, and nested causes",
		() =>
			Effect.gen(function* () {
				const original = Object.assign(
					new Error("token=secret /private/app", {
						cause: new TypeError("credential"),
					}),
					{ code: "EIO" },
				);
				for (const failure of ["read", "dispatch"]) {
					const h = harness(
						snapshot(),
						failure === "read"
							? { readSnapshot: () => Promise.reject(original) }
							: { dispatch: () => Promise.reject(original) },
					);
					const result = yield* Effect.either(run(h, rotate()));
					expect(Either.isLeft(result)).toBe(true);
					if (Either.isLeft(result)) {
						expect(result.left).toBeInstanceOf(KnobDispatchFailed);
						expect(result.left.code).toBe(KnobErrors.KnobDispatchFailed.code);
						expect(result.left.originalCause).toBe(original);
						expect(Object.keys(result.left)).not.toContain("originalCause");
						expect(JSON.stringify(result.left)).not.toMatch(
							/secret|private|credential/,
						);
						expect(
							Either.isRight(
								Schema.decodeUnknownEither(KnobDispatchFailed)(
									JSON.parse(JSON.stringify(result.left)),
								),
							),
						).toBe(true);
					}
				}
			}),
	);
	it.prop(
		"pins catalog identities and preserves private causes for every leaf",
		[fc.string()],
		([secret]) => {
			const cause = new Error(secret);
			for (const Type of [
				InvalidKnobConfig,
				KnobCapabilityUnavailable,
				KnobRouteIncomplete,
				KnobDispatchFailed,
				KnobSessionStale,
			]) {
				const error = Type.fromCause(cause);
				expect(error.originalCause).toBe(cause);
				const serialized: unknown = JSON.parse(JSON.stringify(error));
				expect(Object.keys(error)).not.toContain("originalCause");
				expect(error.diagnosticCause).toEqual({
					name: "Error",
					truncated: true,
				});
				expect(serialized).toMatchObject({
					code: KnobErrors[error._tag].code,
					category: KnobErrors[error._tag].category,
				});
			}
			expect(
				Schema.is(KnobDispatchFailed)({
					...KnobDispatchFailed.fromCause(cause),
					code: "FORGED",
				}),
			).toBe(false);
		},
	);
});
