import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Fiber, Layer, Option, Ref, TestClock } from "effect";
import { ActionService } from "../../src/actions/index.js";
import { QuakeHidWriteFailed } from "../../src/device-errors.js";
import { QuakeDevice } from "../../src/device-service.js";
import { makeFakeHardwareTransport } from "../../src/hardware/hardware-fake.js";
import {
	defaultHardwarePreferences,
	HardwareControls,
	HardwarePreferencesFailed,
	HardwarePreferencesStore,
	hardwareKeyboardAdapter,
} from "../../src/hardware/index.js";
import { harness, press } from "../actions/action-harness.js";

const setup = (onCommand?: Parameters<typeof makeFakeHardwareTransport>[0]) =>
	Effect.gen(function* () {
		const fake = yield* makeFakeHardwareTransport(onCommand);
		const device = yield* QuakeDevice.pipe(
			Effect.provide(
				QuakeDevice.DefaultWithoutDependencies.pipe(Layer.provide(fake.layer)),
			),
		);
		const connection = yield* device.connect();
		const controls = yield* HardwareControls.pipe(
			Effect.provide(HardwareControls.Default),
		);
		return {
			fake,
			connection,
			controls,
			session: yield* controls.create(connection, {
				serial: "A",
				session: "A-1",
			}),
		};
	});

describe("hardware consumers and failure cleanup", () => {
	it.scoped(
		"dispatches a committed ActionService hotkey through device bytes by default and host only after mode switch",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup();
				const h = harness("hotkey", {
					type: "hotkey",
					supportKnob: false,
					actions: [{ type: "key", value: "control+a" }],
				});
				const keyboard = hardwareKeyboardAdapter(session, h.adapters.keyboard);
				const actions = yield* ActionService.pipe(
					Effect.provide(
						h.layer({ ...h.adapters, keyboard: Option.some(keyboard) }),
					),
				);
				const first = yield* actions.activate(press).pipe(Effect.fork);
				yield* TestClock.adjust(50);
				expect(yield* Fiber.join(first)).toBe("executed");
				expect(h.calls).toEqual([]);
				expect((yield* fake.writes).map((b) => [...b.slice(3, 8)])).toEqual([
					[1, 16, 1, 1, 4],
					[1, 16, 0, 1, 4],
				]);
				yield* actions.activate({ ...press, kind: "release", sequence: 2 });
				yield* session.setInputMode("host");
				yield* actions.activate({ ...press, sequence: 3 });
				expect(h.calls).toEqual([["key", "control+a"]]);
				expect(yield* fake.writes).toHaveLength(2);
			}),
	);
	for (const [token, usage] of [
		["leftbracket", 47],
		["rightbracket", 48],
		["numlock", 83],
	] as const) {
		it.scoped(
			`dispatches canonical ${token} through committed ActionService`,
			() =>
				Effect.gen(function* () {
					const { fake, session } = yield* setup();
					const h = harness("hotkey", {
						type: "hotkey",
						supportKnob: false,
						actions: [{ type: "key", value: `control+${token}` }],
					});
					const keyboard = hardwareKeyboardAdapter(
						session,
						h.adapters.keyboard,
					);
					const actions = yield* ActionService.pipe(
						Effect.provide(
							h.layer({ ...h.adapters, keyboard: Option.some(keyboard) }),
						),
					);
					const running = yield* actions.activate(press).pipe(Effect.fork);
					yield* TestClock.adjust(50);
					expect(yield* Fiber.join(running)).toBe("executed");
					expect((yield* fake.writes).map((b) => [...b.slice(3, 8)])).toEqual([
						[1, 16, 1, 1, usage],
						[1, 16, 0, 1, usage],
					]);
					expect(h.calls).toEqual([]);
				}),
		);
	}
	it.scoped(
		"releases keyboard even if the press ack is lost, then refuses reuse",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup({ onCommand: () => [] });
				const fiber = yield* session
					.pressChord("control+a")
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(3000);
				expect(Either.isLeft(yield* Fiber.join(fiber))).toBe(true);
				expect((yield* fake.writes).map((b) => [...b.slice(3, 8)])).toEqual([
					[1, 16, 1, 1, 4],
					[1, 16, 0, 1, 4],
				]);
				expect((yield* session.snapshot()).available).toBe(false);
			}),
	);
	it.scoped(
		"cancels tone with a silence command and emits no new tones when disabled or muted",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup();
				const tone = yield* session.playTone("error").pipe(Effect.fork);
				yield* TestClock.adjust(0);
				yield* Fiber.interrupt(tone);
				expect((yield* fake.writes).map((b) => [...b.slice(3, 6)])).toEqual([
					[1, 2, 84],
					[1, 2, 0],
				]);
				yield* session.configure({
					...defaultHardwarePreferences,
					buzzerEnabled: false,
				});
				yield* session.playTone("busy");
				yield* session.configure({
					...defaultHardwarePreferences,
					alertVolume: 0,
				});
				yield* TestClock.adjust(300);
				yield* session.playTone("end");
				expect(yield* fake.writes).toHaveLength(2);
			}),
	);
	it.scoped(
		"serializes concurrent mic toggles and retains queried state on write failure",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup();
				yield* session.refresh();
				yield* Effect.all([session.toggleMic(), session.toggleMic()], {
					concurrency: "unbounded",
				});
				expect((yield* session.snapshot()).mic).toBe(true);
				expect((yield* fake.writes).slice(-2).map((b) => b[5])).toEqual([0, 1]);
				yield* fake.failWrite(new Error("sensitive cause sk-example-token"));
				const failed = yield* session.toggleMic().pipe(Effect.either);
				expect(Either.isLeft(failed)).toBe(true);
				if (Either.isLeft(failed)) {
					expect(failed.left.originalCause).toBeInstanceOf(QuakeHidWriteFailed);
					expect(failed.left._tag).toBe("HardwareUnavailable");
					expect(failed.left.code).toBe("QUAKE.HARDWARE.UNAVAILABLE");
					expect(failed.left.diagnosticCause).toEqual({
						name: "QuakeHidWriteFailed",
						sourceCode: "QUAKE.HID.WRITE_FAILED",
						cause: { name: "Error", truncated: true },
						truncated: true,
					});
					expect(JSON.stringify(failed.left)).not.toContain("sk-example-token");
				}
				expect((yield* session.snapshot()).mic).toBe(true);
			}),
	);
	it.scoped(
		"keeps preference failures visible and flushes a pending serial on teardown",
		() =>
			Effect.gen(function* () {
				const writes = yield* Ref.make(0);
				const store = Layer.succeed(HardwarePreferencesStore, {
					read: () => Effect.succeed(Option.none()),
					write: () =>
						Ref.update(writes, (n) => n + 1).pipe(
							Effect.zipRight(
								Effect.fail(new HardwarePreferencesFailed("sk-secret")),
							),
						),
				});
				const { connection } = yield* setup();
				yield* Effect.scoped(
					Effect.gen(function* () {
						const controls = yield* HardwareControls.pipe(
							Effect.provide(
								HardwareControls.DefaultWithoutDependencies.pipe(
									Layer.provide(store),
								),
							),
						);
						const session = yield* controls.create(connection, {
							serial: "A",
							session: "pending",
						});
						yield* session.configure({
							...defaultHardwarePreferences,
							knobLedAlwaysOn: false,
						});
						yield* TestClock.adjust(500);
						expect((yield* session.snapshot()).preferenceStatus).toBe("failed");
					}),
				);
				expect(yield* Ref.get(writes)).toBe(2);
			}),
	);
	it.scoped.each([
		["end", 352, [84, 0, 0, 0, 84, 0, 0, 0, 84, 0]],
		["error", 210, [84, 0]],
		["busy", 310, [84, 0, 0, 0, 84, 0, 0, 0, 84, 0]],
	] as const)(
		"plays %s recovered pattern without extra steps",
		([name, duration, levels]) =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup();
				const tone = yield* session.playTone(name).pipe(Effect.fork);
				yield* TestClock.adjust(duration);
				yield* Fiber.join(tone);
				expect((yield* fake.writes).map((b) => b[5])).toEqual(levels);
			}),
	);
});
