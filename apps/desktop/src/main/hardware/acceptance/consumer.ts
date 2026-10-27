import assert from "node:assert/strict";
import { Cause, Effect, Exit, Fiber, Layer, Option, Stream } from "effect";
import { canonicalHidSerial } from "../../../../../../packages/device/src/device-contracts.js";
import { QuakeDevice } from "../../../../../../packages/device/src/device-service.js";
import { HardwareControls } from "../../../../../../packages/device/src/hardware/hardware-service.js";
import { HidTransport } from "../../../../../../packages/device/src/hid-transport.js";
import { safeCause } from "../../diagnostics/privacy.js";
import { exactDeviceTransport } from "./exact-device.js";
import {
	automatedScenarios,
	type ScenarioId,
	type ScenarioResult,
	supervisedScenarios,
} from "./scenarios.js";

/** Preserve the original failure and independently attempt restoration on every exit. */
export function restoring<A, E, R, E2, R2>(
	work: Effect.Effect<A, E, R>,
	restore: Effect.Effect<void, E2, R2>,
) {
	return Effect.uninterruptibleMask((resume) =>
		Effect.gen(function* () {
			const result = yield* Effect.exit(resume(work));
			const cleanup = yield* Effect.exit(restore);
			if (Exit.isFailure(result)) {
				return yield* Effect.failCause(
					Exit.isFailure(cleanup)
						? Cause.sequential(result.cause, cleanup.cause)
						: result.cause,
				);
			}
			if (Exit.isFailure(cleanup))
				return yield* Effect.failCause(cleanup.cause);
			return result.value;
		}),
	);
}

export interface AcceptanceOptions {
	readonly serial: string;
	readonly mutations: boolean;
	readonly keepAliveIntervalMs: number;
	readonly keepAliveObservationMs: number;
}

/** Runs the same production consumers for synthetic and explicitly opted-in native transport. */
export const runHardwareAcceptance = Effect.fn("HardwareAcceptance.run")(
	function* (options: AcceptanceOptions) {
		const results: ScenarioResult[] = [
			...automatedScenarios.map(([id, name]) => ({
				id,
				name,
				status: "skipped" as const,
				reason: "prerequisite did not complete",
			})),
			...supervisedScenarios.map(([id, name]) => ({
				id,
				name,
				status: "manual-or-supervised" as const,
			})),
		];
		const step = <A, E, R>(id: ScenarioId, effect: Effect.Effect<A, E, R>) =>
			Effect.gen(function* () {
				const result = results.find((item) => item.id === id);
				assert(result);
				delete result.reason;
				const exit = yield* Effect.exit(effect);
				if (Exit.isFailure(exit)) {
					result.status = "failed";
					result.cause = safeCause(exit.cause);
					yield* Effect.logError("hardware.acceptance.failed", exit.cause);
					return Option.none<A>();
				}
				result.status = "passed";
				return Option.some(exit.value);
			});
		const source = exactDeviceTransport(yield* HidTransport, options.serial);
		const keepalives: number[] = [];
		const observed = Layer.succeed(HidTransport, {
			...source,
			open: (info) =>
				source.open(info).pipe(
					Effect.map((handle) => ({
						...handle,
						write: (bytes) =>
							handle.write(bytes).pipe(
								Effect.tap(() =>
									Effect.sync(() => {
										if (bytes[1] === 0xa3 && bytes[4] === 0xef)
											keepalives.push(performance.now());
									}),
								),
							),
					})),
				),
		});
		const device = yield* QuakeDevice.pipe(
			Effect.provide(
				QuakeDevice.DefaultWithoutDependencies.pipe(Layer.provide(observed)),
			),
		);
		const selected = yield* step(
			"identity",
			device.discover().pipe(
				Effect.map((devices) => {
					const matching = devices.filter(
						(info) =>
							canonicalHidSerial(info.serialNumber ?? "") === options.serial,
					);
					assert.equal(
						matching.length,
						1,
						"Expected one exact device identity",
					);
					return matching[0];
				}),
			),
		);
		if (Option.isNone(selected) || !selected.value) return results;
		const path = selected.value.path;
		const connectionResult = yield* step(
			"connect",
			device.connect({
				path,
				keepAliveIntervalMs: options.keepAliveIntervalMs,
			}),
		);
		if (Option.isNone(connectionResult)) return results;
		const connection = connectionResult.value;
		const controls = yield* HardwareControls.pipe(
			Effect.provide(HardwareControls.Default),
		);
		const session = yield* controls.create(connection, {
			serial: options.serial,
			session: "hardware-acceptance",
		});
		const refreshed = yield* Effect.exit(session.refresh());
		for (const [id, field] of [
			["firmware", "firmware"],
			["microphone", "mic"],
			["luminance", "luminance"],
		] as const) {
			yield* step(
				id,
				Effect.gen(function* () {
					if (Exit.isFailure(refreshed))
						return yield* Effect.failCause(refreshed.cause);
					assert.notEqual(
						(yield* session.snapshot())[field],
						undefined,
						"Required live query did not return a value",
					);
				}),
			);
		}
		yield* step(
			"qmk",
			session.qmk([{ _tag: "protocol" }]).pipe(
				Effect.tap((values) =>
					Effect.sync(() => {
						assert.equal(values.length, 1);
						assert.equal(values[0]?.length, 2);
						assert((values[0]?.[0] ?? 0) * 256 + (values[0]?.[1] ?? 0) > 0);
					}),
				),
			),
		);
		yield* step(
			"keepalive",
			Effect.gen(function* () {
				yield* Effect.sleep(options.keepAliveObservationMs);
				assert(
					keepalives.length >= 2,
					"Expected at least two actual keepalive writes",
				);
				assert(
					keepalives.some(
						(time, index) =>
							index > 0 &&
							time - (keepalives[index - 1] ?? time) >=
								options.keepAliveIntervalMs * 0.75,
					),
				);
				yield* session.refresh();
				assert.equal((yield* session.snapshot()).available, true);
			}),
		);
		// A raw query uses a subscription acquired before the send, retaining one native owner.
		const readState = (feature: "mic" | "luminance" | "knobLed") =>
			Effect.scoped(
				Effect.gen(function* () {
					const stream = yield* connection.subscribe();
					const waiter = yield* Stream.runHead(
						stream.pipe(
							Stream.filter(
								(event) =>
									event._tag === "HardwareReply" &&
									event.reply._tag ===
										(
											{
												mic: "MicState",
												luminance: "LuminanceState",
												knobLed: "KnobLedState",
											} as const
										)[feature],
							),
						),
					).pipe(Effect.interruptible, Effect.forkScoped);
					yield* connection.sendHardware({ _tag: "Query", feature });
					const event = yield* Fiber.join(waiter).pipe(
						Effect.interruptible,
						Effect.timeout("4 seconds"),
					);
					assert(
						Option.isSome(event) &&
							event.value._tag === "HardwareReply" &&
							event.value.reply._tag !== "Ack" &&
							event.value.reply._tag !== "FirmwareVersion",
					);
					return event.value.reply._tag === "LuminanceState"
						? event.value.reply.value
						: event.value.reply.on;
				}),
			);
		const snapshot = yield* session.snapshot();
		if (
			options.mutations &&
			snapshot.mic !== undefined &&
			snapshot.luminance !== undefined &&
			snapshot.luminance >= 25
		) {
			const mic = snapshot.mic;
			const luminance = snapshot.luminance;
			const restoreMic = Effect.gen(function* () {
				yield* connection.sendHardware({ _tag: "Mic", on: mic });
				assert.equal(
					yield* readState("mic"),
					mic,
					"Microphone restoration readback mismatch",
				);
			});
			yield* step(
				"mic-roundtrip",
				restoring(
					Effect.gen(function* () {
						yield* session.toggleMic();
						yield* session.refresh();
						assert.equal((yield* session.snapshot()).mic, !mic);
					}),
					restoreMic,
				),
			);
			const next = luminance < 255 ? Math.min(255, luminance + 26) : 229;
			yield* step(
				"brightness-roundtrip",
				restoring(
					Effect.gen(function* () {
						yield* session.stepBrightness(luminance < 255 ? 1 : -1);
						yield* session.refresh();
						assert.equal((yield* session.snapshot()).luminance, next);
					}),
					Effect.gen(function* () {
						yield* connection.sendHardware({
							_tag: "Luminance",
							value: luminance,
						});
						assert.equal(
							yield* readState("luminance"),
							luminance,
							"Luminance restoration readback mismatch",
						);
					}),
				),
			);
		} else {
			for (const id of ["mic-roundtrip", "brightness-roundtrip"] as const) {
				const result = results.find((item) => item.id === id);
				if (result)
					result.reason =
						"mutations disabled or no safely restorable original value";
			}
		}

		if (options.mutations) {
			const original = yield* Effect.exit(
				readState("knobLed").pipe(
					Effect.map((value) => {
						assert.equal(typeof value, "boolean");
						return value === true;
					}),
				),
			);
			yield* step(
				"led-roundtrip",
				Effect.gen(function* () {
					if (Exit.isFailure(original))
						return yield* Effect.failCause(original.cause);
					yield* restoring(
						Effect.gen(function* () {
							yield* session.send({ _tag: "KnobLed", on: !original.value });
							assert.equal(yield* readState("knobLed"), !original.value);
						}),
						Effect.gen(function* () {
							yield* connection.sendHardware({
								_tag: "KnobLed",
								on: original.value,
							});
							assert.equal(
								yield* readState("knobLed"),
								original.value,
								"Knob LED restoration readback mismatch",
							);
						}),
					);
				}),
			);
		} else {
			const led = results.find((item) => item.id === "led-roundtrip");
			if (led) led.reason = "mutations disabled";
		}
		yield* step(
			"disconnect",
			Effect.gen(function* () {
				const events = yield* connection.subscribe();
				yield* connection.disconnect();
				const terminal = yield* Stream.runHead(events);
				assert(Option.isSome(terminal) && terminal.value._tag === "Disconnect");
			}),
		);
		yield* step(
			"stale-owner",
			Effect.gen(function* () {
				const result = yield* Effect.either(
					connection.sendHardware({ _tag: "Query", feature: "mic" }),
				);
				assert(
					result._tag === "Left" &&
						result.left._tag === "QuakeConnectionClosed",
				);
			}),
		);
		yield* step(
			"reconnect",
			Effect.gen(function* () {
				const next = yield* device.connect({ path });
				const fresh = yield* controls.create(next, {
					serial: options.serial,
					session: "hardware-acceptance-reconnected",
				});
				yield* fresh.refresh();
				assert.equal((yield* fresh.snapshot()).mic, snapshot.mic);
				assert.equal((yield* fresh.snapshot()).luminance, snapshot.luminance);
			}),
		);
		return results;
	},
);
