import { expect, it } from "@effect/vitest";
import { Clock, Effect, Layer, Runtime, TestClock } from "effect";
import { vi } from "vitest";
import { KnobModelPorts } from "../../../../../packages/device/src/knob/model/ports.js";
import { KnobModel } from "../../../../../packages/device/src/knob/model/service.js";
import type { QuakeEvent } from "../../preload/quake";
import { brightnessController } from "./brightness/controller";
import { type KnobRuntime, registerKnobRuntime } from "./index";

vi.mock("electron", () => ({
	app: {},
	nativeImage: {},
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

const settle = Effect.promise(
	() => new Promise<void>((resolve) => setImmediate(resolve)),
);
for (const scenario of [
	"burst",
	"disconnect",
	"replace-focus",
	"dispose",
] as const) {
	it.scoped(
		`physical brightness ${scenario} keeps the device queue responsive`,
		() =>
			Effect.gen(function* () {
				let percent = 20;
				let presses = 0;
				const writes: { at: number; value: number }[] = [];
				const step = brightnessController({
					read: Effect.sync(() => ({
						target: "fake-display",
						percent,
						quantum: 1,
					})),
					write: (_, value) =>
						Effect.gen(function* () {
							writes.push({ at: yield* Clock.currentTimeMillis, value });
							percent = value;
						}),
				});
				yield* Effect.gen(function* () {
					const captured = yield* Effect.runtime<KnobModel>();
					const runtime: KnobRuntime = {
						runPromise: (effect, options) =>
							Runtime.runPromise(captured)(
								effect,
								options?.signal ? { signal: options.signal } : undefined,
							),
						runPromiseExit: (effect, options) =>
							Runtime.runPromiseExit(captured)(
								effect,
								options?.signal ? { signal: options.signal } : undefined,
							),
						runFork: Runtime.runFork(captured),
						runSync: Runtime.runSync(captured),
						runSyncExit: Runtime.runSyncExit(captured),
						runCallback: Runtime.runCallback(captured),
						dispose: () => Promise.resolve(),
					};
					const context = {
						...(yield* KnobModel.snapshot()).context,
						keys: [
							{
								keyCode: "1,1",
								kind: "brightness" as const,
								visible: true,
								supportKnob: true,
							},
						],
					};
					const registration = registerKnobRuntime(
						runtime,
						Effect.succeed(context),
						() => undefined,
						() => [],
					);
					// The application root also serializes calls to onDevice.
					let input = Promise.resolve();
					const onDevice = (event: QuakeEvent) => {
						input = input.then(() => registration.onDevice(event));
						return input;
					};

					try {
						yield* Effect.promise(() => registration.refresh());
						yield* KnobModel.dispatch({
							_tag: "TapTile",
							sessionId: context.session.sessionId,
							keyCode: "1,1",
						});
						const turns = Array.from({ length: 10 }, () =>
							onDevice({
								source: "mock",
								kind: "rotate",
								direction: 1,
							}),
						);
						yield* settle;
						yield* TestClock.adjust(0);
						const press = onDevice({
							source: "mock",
							kind: "press",
							state: 1,
						});
						let pressed = false;
						void press.then(() => {
							pressed = true;
						});
						yield* settle;
						yield* TestClock.adjust(0);
						expect(pressed).toBe(true);
						expect(presses).toBe(1);
						expect(writes).toHaveLength(0);
						if (scenario === "disconnect") {
							let disconnected = false;
							void onDevice({
								source: "mock",
								kind: "status",
								state: "disconnected",
								reason: "requested",
							}).then(() => {
								disconnected = true;
							});
							yield* settle;
							yield* TestClock.adjust(0);
							expect(disconnected).toBe(true);
						} else if (scenario === "dispose") {
							yield* Effect.promise(() => registration.dispose());
						} else if (scenario === "replace-focus") {
							yield* KnobModel.dispatch({
								_tag: "TapTile",
								sessionId: context.session.sessionId,
								keyCode: "1,1",
							});
						}
						yield* TestClock.adjust(501);
						yield* Effect.promise(() => Promise.all(turns));
						if (scenario === "burst") {
							expect(percent).toBe(70);
							expect(writes.length).toBeLessThanOrEqual(2);
							expect((yield* KnobModel.snapshot()).focus).toMatchObject({
								angle: 120,
							});
						} else {
							expect(writes).toHaveLength(0);
							if (scenario !== "dispose")
								expect((yield* KnobModel.snapshot()).focus._tag).toBe("none");
						}
					} finally {
						yield* Effect.promise(() => registration.dispose());
					}
				}).pipe(
					Effect.provide(
						KnobModel.DefaultWithoutDependencies.pipe(
							Layer.provide(
								Layer.succeed(KnobModelPorts, {
									focusedTurn: (_key, delta) => step(delta),
									voice: () =>
										Effect.sync(() => {
											presses++;
										}),
									selectProfile: () =>
										Effect.die("profile selection must not run"),
									readVolume: Effect.die("volume must not run"),
									writeVolume: () => Effect.die("volume must not run"),
									warmThumbnails: (profiles) => Effect.succeed(profiles),
								}),
							),
						),
					),
				);
			}),
	);
}
