import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Either, Fiber, Option } from "effect";
import { LightingService } from "../../src/lighting/index.js";
import { makeFixture, targetA } from "./fixture.js";

describe("lighting saved snapshot status", () => {
	it.scoped("same-value resubmit returns to saved after readback", () =>
		Effect.gen(function* () {
			const fixture = yield* makeFixture();
			const reading = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			yield* Effect.gen(function* () {
				const lighting = yield* LightingService;
				yield* lighting.select(targetA);
				const saved = yield* lighting.save(targetA);
				expect(saved.saveStatus).toBe("saved");
				const before = (yield* fixture.fakeA.writes).length;
				fixture.control.hook = (bytes, reply) =>
					bytes[1] === 8 && bytes[2] === 9
						? Deferred.succeed(reading, undefined).pipe(
								Effect.zipRight(Deferred.await(release)),
								Effect.zipRight(reply),
							)
						: reply;
				const pending = yield* lighting.setDesired(targetA, {
					field: "brightness",
					value: 20,
				});
				yield* Deferred.await(reading);
				expect(pending.saveStatus).toBe("unsaved");
				expect(yield* lighting.state()).toEqual(Option.some(pending));
				yield* Deferred.succeed(release, undefined);
				const confirmed = yield* lighting.flush(targetA);
				expect(confirmed.applied).toEqual(confirmed.desired);
				expect(confirmed.saved).toEqual(saved.saved);
				expect(confirmed.saveStatus).toBe("saved");
				expect(
					(yield* fixture.fakeA.writes).slice(before).map((r) => r[1]),
				).toEqual([7, 8]);
			}).pipe(Effect.provide(fixture.layer));
		}),
	);
	it.scoped("editing away then back to the saved value restores saved", () =>
		Effect.gen(function* () {
			const fixture = yield* makeFixture();
			yield* Effect.gen(function* () {
				const lighting = yield* LightingService;
				yield* lighting.select(targetA);
				const saved = yield* lighting.save(targetA);
				const before = (yield* fixture.fakeA.writes).length;
				yield* lighting.setDesired(targetA, { field: "brightness", value: 40 });
				const changed = yield* lighting.flush(targetA);
				expect(changed.applied).toContainEqual({
					field: "brightness",
					value: 40,
				});
				expect(changed.saved).toEqual(saved.saved);
				expect(changed.saveStatus).toBe("unsaved");
				yield* lighting.setDesired(targetA, { field: "brightness", value: 20 });
				const restored = yield* lighting.flush(targetA);
				expect(restored.applied).toEqual(
					expect.arrayContaining([...saved.applied]),
				);
				expect(restored.applied).toHaveLength(saved.applied.length);
				expect(restored.desired).toEqual(restored.applied);
				expect(restored.saved).toEqual(saved.saved);
				expect(restored.saveStatus).toBe("saved");
				expect(
					(yield* fixture.fakeA.writes).slice(before).map((r) => r[1]),
				).toEqual([7, 8, 7, 8]);
			}).pipe(Effect.provide(fixture.layer));
		}),
	);
	it.scoped(
		"edits keep save status unknown before the first explicit Save",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					yield* lighting.select(targetA);
					const pending = yield* lighting.setDesired(targetA, {
						field: "brightness",
						value: 40,
					});
					expect(pending.saveStatus).toBe("unknown");
					const confirmed = yield* lighting.flush(targetA);
					expect(confirmed.saveStatus).toBe("unknown");
					expect(Option.isNone(confirmed.saved)).toBe(true);
					expect(
						(yield* fixture.fakeA.writes).filter((r) => r[1] === 9),
					).toHaveLength(0);
				}).pipe(Effect.provide(fixture.layer));
			}),
	);
	it.scoped("matching the saved snapshot does not clear a failed Save", () =>
		Effect.gen(function* () {
			const fixture = yield* makeFixture();
			yield* Effect.gen(function* () {
				const lighting = yield* LightingService;
				yield* lighting.select(targetA);
				const saved = yield* lighting.save(targetA);
				fixture.control.hook = (bytes, reply) =>
					Effect.gen(function* () {
						if (bytes[1] === 9) fixture.valuesA.set(9, [21]);
						yield* reply;
					});
				const result = yield* Effect.either(lighting.save(targetA));
				expect(Either.isLeft(result) && result.left.code).toBe(
					"QUAKE.LIGHTING.SAVE_FAILED",
				);
				fixture.control.hook = (_bytes, reply) => reply;
				const pending = yield* lighting.setDesired(targetA, {
					field: "brightness",
					value: 20,
				});
				expect(pending.saveStatus).toBe("failed");
				const confirmed = yield* lighting.flush(targetA);
				expect(confirmed.applied).toEqual(confirmed.desired);
				expect(confirmed.saved).toEqual(saved.saved);
				expect(confirmed.saveStatus).toBe("failed");
				expect((yield* lighting.save(targetA)).saveStatus).toBe("saved");
			}).pipe(Effect.provide(fixture.layer));
		}),
	);
	it.scoped(
		"a same-value edit during Save stays unsaved until its own readback",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				const saving = yield* Deferred.make<void>();
				const releaseSave = yield* Deferred.make<void>();
				const writing = yield* Deferred.make<void>();
				const releaseEdit = yield* Deferred.make<void>();
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					const selected = yield* lighting.select(targetA);
					fixture.control.hook = (bytes, reply) =>
						bytes[1] === 9
							? Deferred.succeed(saving, undefined).pipe(
									Effect.zipRight(Deferred.await(releaseSave)),
									Effect.zipRight(reply),
								)
							: bytes[1] === 7
								? Deferred.succeed(writing, undefined).pipe(
										Effect.zipRight(Deferred.await(releaseEdit)),
										Effect.zipRight(reply),
									)
								: reply;
					const save = yield* lighting.save(targetA).pipe(Effect.forkScoped);
					yield* Deferred.await(saving);
					yield* lighting.setDesired(targetA, {
						field: "brightness",
						value: 20,
					});
					yield* Deferred.succeed(releaseSave, undefined);
					expect((yield* Fiber.join(save)).saveStatus).toBe("unsaved");
					yield* Deferred.await(writing);
					yield* Deferred.succeed(releaseEdit, undefined);
					const confirmed = yield* lighting.flush(targetA);
					expect(confirmed.saved).toEqual(Option.some(selected.applied));
					expect(confirmed.applied).toEqual(
						expect.arrayContaining([...selected.applied]),
					);
					expect(confirmed.saveStatus).toBe("saved");
					expect(
						(yield* fixture.fakeA.writes).filter((r) => r[1] === 9),
					).toHaveLength(1);
				}).pipe(Effect.provide(fixture.layer));
			}),
	);
});
