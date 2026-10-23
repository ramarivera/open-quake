import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Either, Fiber, Option } from "effect";
import { LightingService } from "../../src/lighting/index.js";
import { capabilities, evidence, makeFixture, targetA } from "./fixture.js";

describe("lighting failure boundaries", () => {
	it.scoped("does not accept a set echo without matching actual readback", () =>
		Effect.gen(function* () {
			const fixture = yield* makeFixture();
			yield* Effect.gen(function* () {
				const lighting = yield* LightingService;
				yield* lighting.select(targetA);
				fixture.control.hook = (bytes, reply) =>
					Effect.gen(function* () {
						if (bytes[1] === 7) fixture.valuesA.set(9, [20]);
						yield* reply;
					});
				yield* lighting.setDesired(targetA, {
					field: "brightness",
					value: 100,
				});
				const result = yield* Effect.either(lighting.flush(targetA));
				expect(Either.isLeft(result) && result.left.code).toBe(
					"QUAKE.LIGHTING.APPLY_FAILED",
				);
				const state = Option.getOrThrow(yield* lighting.state());
				expect(state.desired).toContainEqual({
					field: "brightness",
					value: 100,
				});
				expect(state.applied).toContainEqual({
					field: "brightness",
					value: 20,
				});
				expect(
					(yield* fixture.fakeA.writes).filter((r) => r[1] === 9),
				).toHaveLength(0);
				fixture.control.hook = (_bytes, reply) => reply;
				yield* lighting.setDesired(targetA, {
					field: "brightness",
					value: 100,
				});
				expect((yield* lighting.flush(targetA)).applied).toContainEqual({
					field: "brightness",
					value: 100,
				});
			}).pipe(Effect.provide(fixture.layer));
		}),
	);
	for (const operation of ["apply", "save"] as const) {
		it.scoped(
			`retains the original HID cause behind the ${operation} failure`,
			() =>
				Effect.gen(function* () {
					const fixture = yield* makeFixture();
					const source = Object.assign(
						new Error("token=private-hid-secret /private/hid"),
						{ code: "EIO" },
					);
					yield* Effect.gen(function* () {
						const lighting = yield* LightingService;
						yield* lighting.select(targetA);
						yield* fixture.fakeA.failWrite(source);
						if (operation === "apply")
							yield* lighting.setDesired(targetA, {
								field: "brightness",
								value: 60,
							});
						const result = yield* Effect.either(
							operation === "apply"
								? lighting.flush(targetA)
								: lighting.save(targetA),
						);
						expect(Either.isLeft(result)).toBe(true);
						if (Either.isLeft(result)) {
							expect(result.left.code).toBe(
								operation === "apply"
									? "QUAKE.LIGHTING.APPLY_FAILED"
									: "QUAKE.LIGHTING.SAVE_FAILED",
							);
							let cause: unknown = result.left;
							for (let i = 0; i < 3; i++) {
								expect(cause).toHaveProperty("originalCause");
								cause =
									typeof cause === "object" &&
									cause !== null &&
									"originalCause" in cause
										? cause.originalCause
										: undefined;
							}
							expect(cause).toBe(source);
							for (const text of [
								"private-hid-secret",
								"/private/hid",
								"originalCause",
							])
								expect(JSON.stringify(result.left)).not.toContain(text);
						}
					}).pipe(Effect.provide(fixture.layer));
					expect(yield* fixture.fakeA.closes).toBe(1);
				}),
		);
	}
	it.scoped(
		"validates actual values during initial read instead of inventing defaults",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				fixture.valuesA.set(9, [250]);
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					const result = yield* Effect.either(lighting.select(targetA));
					expect(Either.isLeft(result) && result.left._tag).toBe(
						"LightingReadFailed",
					);
					expect(Option.getOrThrow(yield* lighting.state()).status).toBe(
						"unavailable",
					);
				}).pipe(Effect.provide(fixture.layer));
				expect(yield* fixture.fakeA.closes).toBe(1);
			}),
	);
	it.scoped(
		"rejects a registered protocol identity that differs from device readback",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				fixture.control.hook = (_bytes, _reply) => {
					const wrong = new Uint8Array(32);
					wrong.set([1, 0, 11]);
					return fixture.fakeA.emit(wrong);
				};
				yield* Effect.gen(function* () {
					const result = yield* Effect.either(
						(yield* LightingService).select(targetA),
					);
					expect(Either.isLeft(result) && result.left._tag).toBe(
						"LightingTargetUnavailable",
					);
				}).pipe(Effect.provide(fixture.layer));
				expect((yield* fixture.fakeA.writes).map((r) => r[1])).toEqual([1]);
				expect(yield* fixture.fakeA.closes).toBe(1);
			}),
	);
	it.scoped("rejects changed bindings before sending an edit", () =>
		Effect.gen(function* () {
			const fixture = yield* makeFixture();
			yield* Effect.gen(function* () {
				const lighting = yield* LightingService;
				yield* lighting.select(targetA);
				const before = yield* fixture.fakeA.writes;
				fixture.registrations.delete(targetA.serial);
				yield* lighting.setDesired(targetA, { field: "brightness", value: 50 });
				const result = yield* Effect.either(lighting.flush(targetA));
				expect(Either.isLeft(result) && result.left._tag).toBe(
					"LightingTargetUnavailable",
				);
				expect(yield* fixture.fakeA.writes).toEqual(before);
			}).pipe(Effect.provide(fixture.layer));
		}),
	);
	it.scoped(
		"cancelling selection closes its handle and requires another actual read",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture();
				const reading = yield* Deferred.make<void>();
				fixture.control.hook = (bytes, reply) =>
					bytes[1] === 8
						? Deferred.succeed(reading, undefined).pipe(
								Effect.zipRight(Effect.never),
							)
						: reply;
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					const selecting = yield* lighting
						.select(targetA)
						.pipe(Effect.forkScoped);
					yield* Deferred.await(reading);
					yield* Fiber.interrupt(selecting);
					expect(yield* fixture.fakeA.closes).toBe(1);
					fixture.control.hook = (_bytes, reply) => reply;
					fixture.valuesA.set(9, [45]);
					expect((yield* lighting.select(targetA)).applied).toContainEqual({
						field: "brightness",
						value: 45,
					});
				}).pipe(Effect.provide(fixture.layer));
				expect(yield* fixture.fakeA.closes).toBe(2);
			}),
	);
	it.scoped(
		"reads a qualified read-only field, accepts color2 only when declared, and refuses absent Save",
		() =>
			Effect.gen(function* () {
				const fixture = yield* makeFixture({
					...capabilities,
					fields: [
						{
							field: "brightness",
							valueId: 9,
							range: { min: 0, max: 255 },
							readable: true,
							writable: false,
							evidence,
						},
						{
							field: "color2",
							valueId: 13,
							hue: { min: 0, max: 180 },
							saturation: { min: 0, max: 200 },
							readable: true,
							writable: true,
							evidence,
						},
					],
					save: Option.none(),
				});
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					const initial = yield* lighting.select(targetA);
					expect(initial.applied).toContainEqual({
						field: "color2",
						value: { hue: 90, saturation: 100 },
					});
					const readOnly = yield* Effect.either(
						lighting.setDesired(targetA, { field: "brightness", value: 100 }),
					);
					expect(Either.isLeft(readOnly) && readOnly.left._tag).toBe(
						"LightingValueUnsupported",
					);
					yield* lighting.setDesired(targetA, {
						field: "color2",
						value: { hue: 150, saturation: 190 },
					});
					expect((yield* lighting.flush(targetA)).applied).toContainEqual({
						field: "color2",
						value: { hue: 150, saturation: 190 },
					});
					const save = yield* Effect.either(lighting.save(targetA));
					expect(Either.isLeft(save) && save.left._tag).toBe(
						"LightingValueUnsupported",
					);
					expect(
						(yield* fixture.fakeA.writes)
							.filter((r) => r[1] === 7)
							.map((r) => Array.from(r.slice(1, 5))),
					).toEqual([[7, 13, 150, 190]]);
					expect(
						(yield* fixture.fakeA.writes).filter((r) => r[1] === 9),
					).toHaveLength(0);
				}).pipe(Effect.provide(fixture.layer));
			}),
	);
});
