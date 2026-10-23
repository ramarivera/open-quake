import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Either, Fiber, Option, TestClock } from "effect";
import { LightingService } from "../../src/lighting/index.js";
import { capabilities, makeFixture, targetA, targetB } from "./fixture.js";

describe("lighting conductor through hid-fake", () => {
	it.scoped(
		"selects the serial/session rather than the first path and reads actual state",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					const state = yield* lighting.select(targetA);
					expect(state.status).toBe("ready");
					expect(state.desired).toEqual(state.applied);
					expect(state.applied).toContainEqual({
						field: "brightness",
						value: 20,
					});
					expect(state.saveStatus).toBe("unknown");
					expect(Option.isNone(state.saved)).toBe(true);
					expect(yield* fixture.fakeB.opens).toBe(0);
					expect(
						(yield* fixture.fakeA.writes).map((report) =>
							Array.from(report.slice(0, 4)),
						),
					).toEqual([
						[0, 1, 0, 0],
						[0, 8, 9, 0],
						[0, 8, 10, 0],
						[0, 8, 11, 0],
						[0, 8, 12, 0],
					]);
					expect(JSON.stringify(state)).not.toContain("private:hid");
				}).pipe(Effect.provide(fixture.layer));
				expect(yield* fixture.fakeA.closes).toBe(1);
			}),
	);
	it.scoped("rejects invalid and unsupported edits before transport", () =>
		Effect.gen(function* () {
			const fixture = yield* makeFixture();
			yield* Effect.gen(function* () {
				const lighting = yield* LightingService;
				yield* lighting.select(targetA);
				const before = yield* fixture.fakeA.writes;
				for (const input of [
					{ field: "brightness", value: 256 },
					{ field: "brightness", value: 1.5 },
					{ field: "brightness", value: 201 },
					{ field: "effect", value: 3 },
					{ field: "color1", value: { hue: -1, saturation: 4 } },
					{ field: "color1", value: "#ffffff" },
					{ field: "effectSpeed", value: Number.NaN },
				]) {
					const result = yield* Effect.either(
						lighting.setDesired(targetA, input),
					);
					expect(Either.isLeft(result) && result.left._tag).toBe(
						"InvalidLightingValue",
					);
				}
				const color2 = yield* Effect.either(
					lighting.setDesired(targetA, {
						field: "color2",
						value: { hue: 1, saturation: 2 },
					}),
				);
				expect(Either.isLeft(color2) && color2.left._tag).toBe(
					"LightingValueUnsupported",
				);
				expect(yield* fixture.fakeA.writes).toEqual(before);
			}).pipe(Effect.provide(fixture.layer));
		}),
	);
	it.scoped(
		"coalesces a slider burst, preserves newer desired values, and saves explicitly",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				const writing = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					yield* lighting.select(targetA);
					let first = true;
					fixture.control.hook = (bytes, reply) =>
						bytes[1] === 7 && first
							? Effect.gen(function* () {
									first = false;
									yield* Deferred.succeed(writing, undefined);
									yield* Deferred.await(release);
									yield* reply;
								})
							: reply;
					yield* lighting.setDesired(targetA, {
						field: "brightness",
						value: 30,
					});
					yield* Deferred.await(writing);
					yield* lighting.setDesired(targetA, {
						field: "brightness",
						value: 40,
					});
					const editing = yield* lighting.setDesired(targetA, {
						field: "brightness",
						value: 50,
					});
					expect(editing.desired).toContainEqual({
						field: "brightness",
						value: 50,
					});
					expect(editing.applied).toContainEqual({
						field: "brightness",
						value: 20,
					});
					yield* Deferred.succeed(release, undefined);
					const applied = yield* lighting.flush(targetA);
					expect(applied.desired).toContainEqual({
						field: "brightness",
						value: 50,
					});
					expect(applied.applied).toContainEqual({
						field: "brightness",
						value: 50,
					});
					expect(applied.saveStatus).toBe("unsaved");
					expect(
						(yield* fixture.fakeA.writes)
							.filter((r) => r[1] === 7)
							.map((r) => r[3]),
					).toEqual([30, 50]);
					expect(
						(yield* fixture.fakeA.writes).filter((r) => r[1] === 9),
					).toHaveLength(0);
					const saved = yield* lighting.save(targetA);
					expect(saved.saveStatus).toBe("saved");
					expect(saved.saved).toEqual(Option.some(saved.applied));
					expect(
						(yield* fixture.fakeA.writes).filter((r) => r[1] === 9),
					).toHaveLength(1);
				}).pipe(Effect.provide(fixture.layer));
			}),
	);
	it.scoped(
		"retains applied values and desired edits when Save fails, then allows explicit retry",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					yield* lighting.select(targetA);
					yield* lighting.setDesired(targetA, {
						field: "brightness",
						value: 70,
					});
					const applied = yield* lighting.flush(targetA);
					fixture.control.hook = (bytes, reply) =>
						Effect.gen(function* () {
							if (bytes[1] === 9) fixture.valuesA.set(9, [71]);
							yield* reply;
						});
					const result = yield* Effect.either(lighting.save(targetA));
					expect(Either.isLeft(result) && result.left.code).toBe(
						"QUAKE.LIGHTING.SAVE_FAILED",
					);
					const state = Option.getOrThrow(yield* lighting.state());
					expect(state.applied).toEqual(applied.applied);
					expect(state.desired).toEqual(applied.desired);
					expect(state.saveStatus).toBe("failed");
					expect(Option.isNone(state.saved)).toBe(true);
					fixture.control.hook = (_bytes, reply) => reply;
					fixture.valuesA.set(9, [70]);
					expect((yield* lighting.save(targetA)).saveStatus).toBe("saved");
				}).pipe(Effect.provide(fixture.layer));
			}),
	);
	it.scoped(
		"discards target A's late read and keeps target B's actual state",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				const reading = yield* Deferred.make<void>();
				fixture.control.hook = (bytes, reply) =>
					bytes[1] === 8 && bytes[2] === 9
						? Deferred.succeed(reading, undefined).pipe(
								Effect.zipRight(Effect.never),
							)
						: reply;
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					const selectingA = yield* lighting
						.select(targetA)
						.pipe(Effect.either, Effect.forkScoped);
					yield* Deferred.await(reading);
					fixture.control.hook = (_bytes, reply) => reply;
					fixture.valuesB.set(9, [99]);
					const b = yield* lighting.select(targetB);
					const old = yield* Fiber.join(selectingA);
					expect(Either.isLeft(old) && old.left._tag).toBe(
						"LightingTargetUnavailable",
					);
					const late = new Uint8Array(32);
					late.set([8, 9, 20]);
					yield* fixture.fakeA.emit(late);
					expect(Option.getOrThrow(yield* lighting.state())).toEqual(b);
					expect(b.applied).toContainEqual({ field: "brightness", value: 99 });
					expect(yield* fixture.fakeA.closes).toBe(1);
				}).pipe(Effect.provide(fixture.layer));
			}),
	);
	it.scoped(
		"rejects a stale firmware binding and unknown sessions without opening HID",
		() =>
			Effect.gen(function* () {
				const first = capabilities.fields[0];
				if (!first) return;
				const fixture = yield* makeFixture({
					...capabilities,
					fields: [
						{
							...first,
							evidence: {
								...first.evidence,
								identity: {
									...capabilities.identity,
									firmware: "old-firmware",
								},
							},
						},
					],
				});
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					for (const target of [
						targetA,
						{ ...targetB, session: "old-session" },
					]) {
						const result = yield* Effect.either(lighting.select(target));
						expect(Either.isLeft(result) && result.left._tag).toBe(
							"LightingTargetUnavailable",
						);
					}
				}).pipe(Effect.provide(fixture.layer));
				expect(yield* fixture.fakeA.opens).toBe(0);
				expect(yield* fixture.fakeB.opens).toBe(0);
			}),
	);
	it.scoped(
		"keeps unknown v3 bindings unavailable with no probes or writes",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture({
					...capabilities,
					identity: { ...capabilities.identity, protocolVersion: 11 },
					transport: "unavailable",
					fields: [],
					save: Option.none(),
				});
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					expect((yield* lighting.select(targetA)).status).toBe("unavailable");
					const result = yield* Effect.either(
						lighting.setDesired(targetA, { field: "brightness", value: 10 }),
					);
					expect(Either.isLeft(result) && result.left._tag).toBe(
						"LightingValueUnsupported",
					);
					const save = yield* Effect.either(lighting.save(targetA));
					expect(Either.isLeft(save) && save.left._tag).toBe(
						"LightingValueUnsupported",
					);
				}).pipe(Effect.provide(fixture.layer));
				expect(yield* fixture.fakeA.opens).toBe(0);
				expect(yield* fixture.fakeA.writes).toHaveLength(0);
			}),
	);
	it.scoped(
		"detach cancels the old-session queue and reconnect reads without replay",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				const writing = yield* Deferred.make<void>();
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					yield* lighting.select(targetA);
					fixture.control.hook = (bytes, reply) =>
						bytes[1] === 7
							? Deferred.succeed(writing, undefined).pipe(
									Effect.zipRight(Effect.never),
								)
							: reply;
					yield* lighting.setDesired(targetA, {
						field: "brightness",
						value: 30,
					});
					yield* Deferred.await(writing);
					yield* lighting.setDesired(targetA, {
						field: "brightness",
						value: 60,
					});
					const flushing = yield* lighting
						.flush(targetA)
						.pipe(Effect.either, Effect.forkScoped);
					yield* fixture.fakeA.end();
					expect(Either.isLeft(yield* Fiber.join(flushing))).toBe(true);
					fixture.control.hook = (_bytes, reply) => reply;
					const freshTarget = { ...targetA, session: "fresh-session" };
					const registration = fixture.registrations.get(targetA.serial);
					if (!registration) return;
					fixture.registrations.set(targetA.serial, {
						...registration,
						capabilities: { ...capabilities, target: freshTarget },
					});
					fixture.valuesA.set(9, [45]);
					const fresh = yield* lighting.select(freshTarget);
					expect(fresh.applied).toContainEqual({
						field: "brightness",
						value: 45,
					});
					expect(fresh.desired).toEqual(fresh.applied);
					expect(fresh.saveStatus).toBe("unknown");
					expect(
						(yield* fixture.fakeA.writes)
							.filter((r) => r[1] === 7)
							.map((r) => r[3]),
					).toEqual([30]);
					expect(
						(yield* fixture.fakeA.writes).filter((r) => r[1] === 9),
					).toHaveLength(0);
				}).pipe(Effect.provide(fixture.layer));
			}),
	);
	it.scoped(
		"times out unmatched responses, closes the connection, and does not retry",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				const writing = yield* Deferred.make<void>();
				fixture.control.hook = (_bytes, _reply) =>
					Deferred.succeed(writing, undefined).pipe(Effect.asVoid);
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					const selecting = yield* lighting
						.select(targetA)
						.pipe(Effect.either, Effect.forkScoped);
					yield* Deferred.await(writing);
					const wrong = new Uint8Array(32);
					wrong.set([8, 9, 20]);
					yield* fixture.fakeA.emit(wrong);
					yield* TestClock.adjust(1500);
					const result = yield* Fiber.join(selecting);
					expect(Either.isLeft(result) && result.left._tag).toBe(
						"LightingReadFailed",
					);
					expect(yield* fixture.fakeA.closes).toBe(1);
					expect(yield* fixture.fakeA.writes).toHaveLength(1);
				}).pipe(Effect.provide(fixture.layer));
			}),
	);
});
