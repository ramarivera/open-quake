import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Logger, TestClock } from "effect";
import { KnobDispatchFailed } from "../../../../../packages/device/src/knob/knob-errors.js";
import { KnobModelPorts } from "../../../../../packages/device/src/knob/model/ports.js";
import { KnobModel } from "../../../../../packages/device/src/knob/model/service.js";
import { observeVolume } from "./volume-observer";

const layer = KnobModel.DefaultWithoutDependencies.pipe(
	Layer.provide(
		Layer.succeed(KnobModelPorts, {
			selectProfile: () => Effect.never,
			focusedTurn: () => Effect.void,
			voice: () => Effect.void,
			readVolume: Effect.succeed({ level: 50, muted: false }),
			writeVolume: () => Effect.void,
			warmThumbnails: (p) => Effect.succeed(p),
		}),
	),
);
const armed = Effect.gen(function* () {
	const model = yield* KnobModel;
	const context = (yield* model.snapshot()).context;
	yield* model.configure({ ...context, player: true });
	yield* model.dispatch({
		_tag: "ToggleVolume",
		sessionId: context.session.sessionId,
	});
	return { model, context };
});
describe("external-volume observation", () => {
	it.scoped(
		"logs a persistent failure once and logs recurrence after recovery",
		() =>
			Effect.gen(function* () {
				yield* armed;
				let broken = true;
				let warnings = 0;
				const failure = KnobDispatchFailed.fromCause(
					Object.assign(new Error("private"), { code: "EACCES" }),
				);
				const fiber = yield* observeVolume(
					Effect.suspend(() =>
						broken
							? Effect.fail(failure)
							: Effect.succeed({ level: 50, muted: false }),
					),
					() => true,
				).pipe(
					Effect.provide(
						Logger.replace(
							Logger.defaultLogger,
							Logger.make(() => {
								warnings++;
							}),
						),
					),
					Effect.forkScoped,
				);
				yield* TestClock.adjust(4000);
				expect(warnings).toBe(1);
				broken = false;
				yield* TestClock.adjust(1000);
				broken = true;
				yield* TestClock.adjust(2000);
				expect(warnings).toBe(2);
				yield* Fiber.interrupt(fiber);
			}).pipe(Effect.provide(layer)),
	);

	it.scoped(
		"reads only while armed, updates the real model without writes, and stops after disposal",
		() =>
			Effect.gen(function* () {
				const model = yield* KnobModel;
				const initial = (yield* model.snapshot()).context;
				yield* model.configure({ ...initial, player: true });
				let reads = 0;
				let connected = true;
				const fiber = yield* observeVolume(
					Effect.sync(() => {
						reads++;
						return { level: 72, muted: true };
					}),
					() => connected,
				).pipe(Effect.forkScoped);
				yield* TestClock.adjust(1000);
				expect(reads).toBe(0);
				yield* model.dispatch({
					_tag: "ToggleVolume",
					sessionId: initial.session.sessionId,
				});
				yield* TestClock.adjust(1000);
				expect((yield* model.snapshot()).volume).toMatchObject({
					level: 72,
					muted: true,
					phase: "active",
				});
				expect(reads).toBe(1);
				connected = false;
				yield* TestClock.adjust(5000);
				expect(reads).toBe(1);
				yield* Fiber.interrupt(fiber);
				connected = true;
				yield* TestClock.adjust(5000);
				expect(reads).toBe(1);
			}).pipe(Effect.provide(layer)),
	);
	it.scoped("discards a reading from a replaced session", () =>
		Effect.gen(function* () {
			const { model, context } = yield* armed;
			const entered = yield* Deferred.make<void>();
			const release = yield* Deferred.make<{ level: number; muted: boolean }>();
			const read = Deferred.succeed(entered, undefined).pipe(
				Effect.zipRight(Deferred.await(release)),
			);
			const fiber = yield* observeVolume(read, () => true).pipe(
				Effect.forkScoped,
			);
			yield* Deferred.await(entered);
			yield* model.configure({
				...context,
				session: { ...context.session, sessionId: "replacement" },
				player: true,
			});
			yield* Deferred.succeed(release, { level: 99, muted: true });
			yield* TestClock.adjust(1000);
			expect((yield* model.snapshot()).volume.level).not.toBe(99);
			yield* Fiber.interrupt(fiber);
		}).pipe(Effect.provide(layer)),
	);
	it.scoped(
		"preserves the 500 ms desired-volume guard before accepting external readings",
		() =>
			Effect.gen(function* () {
				yield* TestClock.adjust(1000);
				const { model, context } = yield* armed;
				yield* model.dispatch({
					_tag: "Rotate",
					sessionId: context.session.sessionId,
					delta: 1,
				});
				const fiber = yield* observeVolume(
					Effect.succeed({ level: 80, muted: true }),
					() => true,
				).pipe(Effect.forkScoped);
				yield* TestClock.adjust(0);
				expect((yield* model.snapshot()).volume.level).toBe(51);
				yield* TestClock.adjust(1000);
				expect((yield* model.snapshot()).volume).toMatchObject({
					level: 80,
					muted: true,
				});
				yield* Fiber.interrupt(fiber);
			}).pipe(Effect.provide(layer)),
	);
	it.scoped(
		"interrupts stalled reads after three seconds and never overlaps retries",
		() =>
			Effect.gen(function* () {
				yield* armed;
				let reads = 0;
				let interrupted = 0;
				const read = Effect.sync(() => {
					reads++;
				}).pipe(
					Effect.zipRight(Effect.never),
					Effect.onInterrupt(() =>
						Effect.sync(() => {
							interrupted++;
						}),
					),
				);
				const fiber = yield* observeVolume(read, () => true).pipe(
					Effect.forkScoped,
				);
				yield* TestClock.adjust(0);
				expect(reads).toBe(1);
				yield* TestClock.adjust(3000);
				expect(interrupted).toBe(1);
				expect(reads).toBe(1);
				yield* TestClock.adjust(1000);
				expect(reads).toBe(2);
				yield* Fiber.interrupt(fiber);
				expect(interrupted).toBe(2);
			}).pipe(Effect.provide(layer)),
	);
	it.scoped(
		"discards a read begun before a detent even when it completes after the guard",
		() =>
			Effect.gen(function* () {
				yield* TestClock.adjust(1000);
				const { model, context } = yield* armed;
				const entered = yield* Deferred.make<void>();
				const release = yield* Deferred.make<{
					level: number;
					muted: boolean;
				}>();
				const fiber = yield* observeVolume(
					Deferred.succeed(entered, undefined).pipe(
						Effect.zipRight(Deferred.await(release)),
					),
					() => true,
				).pipe(Effect.forkScoped);
				yield* Deferred.await(entered);
				yield* model.dispatch({
					_tag: "Rotate",
					sessionId: context.session.sessionId,
					delta: 1,
				});
				yield* TestClock.adjust(600);
				yield* Deferred.succeed(release, { level: 2, muted: true });
				yield* TestClock.adjust(0);
				expect((yield* model.snapshot()).volume.level).toBe(51);
				yield* Fiber.interrupt(fiber);
			}).pipe(Effect.provide(layer)),
	);
});
