import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option } from "effect";
import { LightingService } from "../../src/lighting/index.js";
import { makeFixture, targetA, targetB } from "./fixture.js";

describe("lighting request ordering", () => {
	it.scoped(
		"target switch waits for a native write to settle before closing its handle",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				const writing = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					yield* lighting.select(targetA);
					fixture.control.write = (bytes, write) =>
						bytes[1] === 7
							? Deferred.succeed(writing, undefined).pipe(
									Effect.zipRight(Deferred.await(release)),
									Effect.zipRight(write),
								)
							: write;
					yield* lighting.setDesired(targetA, {
						field: "brightness",
						value: 50,
					});
					yield* Deferred.await(writing);
					const switching = yield* lighting
						.select(targetB)
						.pipe(Effect.forkScoped);
					yield* Effect.yieldNow();
					expect(yield* fixture.fakeA.closes).toBe(0);
					expect(yield* fixture.fakeB.opens).toBe(0);
					yield* Deferred.succeed(release, undefined);
					expect((yield* Fiber.join(switching)).capabilities.target).toEqual(
						targetB,
					);
					expect(yield* fixture.fakeA.closes).toBe(1);
					expect(
						(yield* fixture.fakeA.writes)
							.filter((r) => r[1] === 7)
							.map((r) => r[3]),
					).toEqual([50]);
				}).pipe(Effect.provide(fixture.layer));
			}),
	);
	it.scoped(
		"retains one latest pending value per field across concurrent editors",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				const writing = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					yield* lighting.select(targetA);
					let blocked = false;
					fixture.control.hook = (bytes, reply) =>
						bytes[1] === 7 && !blocked
							? Effect.gen(function* () {
									blocked = true;
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
					yield* Effect.all(
						Array.from({ length: 100 }, (_, value) =>
							lighting.setDesired(targetA, { field: "brightness", value }),
						),
						{ concurrency: "unbounded" },
					);
					yield* lighting.setDesired(targetA, {
						field: "brightness",
						value: 120,
					});
					yield* lighting.setDesired(targetA, { field: "effect", value: 7 });
					yield* lighting.setDesired(targetA, {
						field: "color1",
						value: { hue: 40, saturation: 60 },
					});
					yield* Deferred.succeed(release, undefined);
					const state = yield* lighting.flush(targetA);
					expect(state.desired).toEqual(state.applied);
					expect(state.applied).toContainEqual({
						field: "brightness",
						value: 120,
					});
					expect(state.applied).toContainEqual({ field: "effect", value: 7 });
					expect(state.applied).toContainEqual({
						field: "color1",
						value: { hue: 40, saturation: 60 },
					});
					expect(
						(yield* fixture.fakeA.writes)
							.filter((r) => r[1] === 7)
							.map((r) => r[2]),
					).toEqual([9, 9, 10, 12]);
				}).pipe(Effect.provide(fixture.layer));
			}),
	);
	it.scoped(
		"Save waits for pending apply and readback before issuing the save command",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				const writing = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					yield* lighting.select(targetA);
					const before = (yield* fixture.fakeA.writes).length;
					fixture.control.hook = (bytes, reply) =>
						bytes[1] === 7
							? Deferred.succeed(writing, undefined).pipe(
									Effect.zipRight(Deferred.await(release)),
									Effect.zipRight(reply),
								)
							: reply;
					yield* lighting.setDesired(targetA, {
						field: "brightness",
						value: 80,
					});
					yield* Deferred.await(writing);
					const saving = yield* lighting.save(targetA).pipe(Effect.forkScoped);
					expect(
						(yield* fixture.fakeA.writes).filter((r) => r[1] === 9),
					).toHaveLength(0);
					yield* Deferred.succeed(release, undefined);
					expect((yield* Fiber.join(saving)).saveStatus).toBe("saved");
					expect(
						(yield* fixture.fakeA.writes).slice(before).map((r) => r[1]),
					).toEqual([7, 8, 9, 8, 8, 8, 8]);
				}).pipe(Effect.provide(fixture.layer));
			}),
	);
	it.scoped(
		"an edit during Save stays unsaved and is applied after the saved snapshot",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				const saving = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					yield* lighting.select(targetA);
					fixture.control.hook = (bytes, reply) =>
						bytes[1] === 9
							? Deferred.succeed(saving, undefined).pipe(
									Effect.zipRight(Deferred.await(release)),
									Effect.zipRight(reply),
								)
							: reply;
					const save = yield* lighting.save(targetA).pipe(Effect.forkScoped);
					yield* Deferred.await(saving);
					yield* lighting.setDesired(targetA, {
						field: "brightness",
						value: 90,
					});
					yield* lighting.setDesired(targetA, {
						field: "brightness",
						value: 100,
					});
					yield* Deferred.succeed(release, undefined);
					expect((yield* Fiber.join(save)).saveStatus).toBe("unsaved");
					const state = yield* lighting.flush(targetA);
					expect(state.applied).toContainEqual({
						field: "brightness",
						value: 100,
					});
					expect(Option.getOrThrow(state.saved)).toContainEqual({
						field: "brightness",
						value: 20,
					});
					expect(state.saveStatus).toBe("unsaved");
					expect(
						(yield* fixture.fakeA.writes)
							.filter((r) => r[1] === 7)
							.map((r) => r[3]),
					).toEqual([100]);
				}).pipe(Effect.provide(fixture.layer));
			}),
	);
});
