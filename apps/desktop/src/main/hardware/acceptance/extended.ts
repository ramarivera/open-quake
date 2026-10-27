import assert from "node:assert/strict";
import { Effect, Exit, Layer, Option } from "effect";
import { canonicalHidSerial } from "../../../../../../packages/device/src/device-contracts.js";
import { QuakeDevice } from "../../../../../../packages/device/src/device-service.js";
import { HardwareControls } from "../../../../../../packages/device/src/hardware/hardware-service.js";
import { HidTransport } from "../../../../../../packages/device/src/hid-transport.js";
import type { LightingChange } from "../../../../../../packages/device/src/lighting/lighting-contracts.js";
import { LightingService } from "../../../../../../packages/device/src/lighting/lighting-service.js";
import { safeCause } from "../../diagnostics/privacy.js";
import { sharedLighting } from "../qmk-lighting.js";
import { restoring } from "./consumer.js";
import { exactDeviceTransport } from "./exact-device.js";
import { restoreLightingValue } from "./restore-lighting.js";
import { probeV3Lighting } from "./v3-lighting.js";

export interface ExtendedCheck {
	readonly id: string;
	readonly status: "passed" | "failed" | "skipped";
	readonly cause?: object;
	readonly reason?: string;
}

/** Supplemental checks do not replace the original twenty-scenario denominator. */
export const runExtendedAcceptance = Effect.fn("HardwareAcceptance.extended")(
	function* (options: {
		readonly serial: string;
		readonly mutations: boolean;
		readonly cycles: number;
	}) {
		assert(
			Number.isInteger(options.cycles) &&
				options.cycles >= 1 &&
				options.cycles <= 30,
		);
		const ids = [
			"concurrent-query-serialization",
			"lighting-qualified-readback",
			"lighting-brightness-roundtrip",
			"lighting-effectSpeed-roundtrip",
			"lighting-color1-roundtrip",
			"lighting-all-originals-restored",
			"stale-lighting-target-rejected",
			"v3-speed-restoration-and-readonly-state",
			"software-reconnect-stress",
			"all-native-handles-closed",
		];
		const results: ExtendedCheck[] = ids.map((id) => ({
			id,
			status: "skipped",
			reason: "prerequisite not complete",
		}));
		const record = (result: ExtendedCheck) => {
			const index = results.findIndex((item) => item.id === result.id);
			assert(index >= 0);
			results[index] = result;
		};
		let lightingQualification: object | undefined;

		const step = <A, E, R>(id: string, effect: Effect.Effect<A, E, R>) =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(effect);
				if (Exit.isFailure(exit)) {
					record({ id, status: "failed", cause: safeCause(exit.cause) });
					yield* Effect.logError("hardware.acceptance.failed", exit.cause);
					return Option.none<A>();
				}
				record({ id, status: "passed" });
				return Option.some(exit.value);
			});
		const source = exactDeviceTransport(yield* HidTransport, options.serial);
		let opens = 0,
			closes = 0,
			writes = 0;
		const transport = Layer.succeed(HidTransport, {
			...source,
			open: (info) =>
				source.open(info).pipe(
					Effect.map((handle) => {
						opens++;
						return {
							...handle,
							write: (report) =>
								handle.write(report).pipe(
									Effect.tap(() =>
										Effect.sync(() => {
											writes++;
										}),
									),
								),
							close: () =>
								handle.close().pipe(
									Effect.tap(() =>
										Effect.sync(() => {
											closes++;
										}),
									),
								),
						};
					}),
				),
		});
		yield* Effect.scoped(
			Effect.gen(function* () {
				const device = yield* QuakeDevice.pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(transport),
						),
					),
				);
				const controls = yield* HardwareControls.pipe(
					Effect.provide(HardwareControls.Default),
				);
				const discovered = yield* device.discover();
				const selected = discovered.filter(
					(info) =>
						canonicalHidSerial(info.serialNumber ?? "") === options.serial,
				);
				assert.equal(selected.length, 1, "Expected one exact native identity");
				const info = selected[0];
				assert(info);
				const connection = yield* device.connect({ path: info.path });
				const session = yield* controls.create(connection, {
					serial: options.serial,
					session: "extended-acceptance",
				});
				yield* session.refresh();
				const initial = yield* session.snapshot();
				yield* step(
					"concurrent-query-serialization",
					Effect.all(
						Array.from({ length: 12 }, (_, index) =>
							index % 2 === 0
								? session.refresh()
								: session.qmk([{ _tag: "protocol" }]).pipe(Effect.asVoid),
						),
						{ concurrency: 4 },
					),
				);
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					const target = {
						serial: options.serial,
						session: "extended-acceptance",
					};
					const state = yield* step(
						"lighting-qualified-readback",
						lighting.select(target).pipe(
							Effect.tap((state) =>
								Effect.sync(() => {
									lightingQualification = {
										identity: state.capabilities.identity,
										status: state.status,
										fields: state.capabilities.fields.map((cap) => cap.field),
									};
									if (state.status === "unavailable") return;
									assert.equal(state.status, "ready");
									assert.equal(
										state.applied.length,
										state.capabilities.transport === "v3" ? 1 : 3,
									);
								}),
							),
						),
					);
					if (Option.isNone(state)) return;
					if (state.value.status !== "ready") {
						record({
							id: "lighting-qualified-readback",
							status: "skipped",
							reason:
								"Installed firmware is not qualified by the production LightingService",
						});
						return;
					}
					const originals = state.value.applied;
					const caps = state.value.capabilities.fields;
					for (const field of [
						"brightness",
						"effectSpeed",
						"color1",
					] as const) {
						if (!caps.some((cap) => cap.field === field && cap.writable))
							record({
								id: `lighting-${field}-roundtrip`,
								status: "skipped",
								reason: "Field is not qualified for this firmware",
							});
					}
					for (const original of originals) {
						const id = `lighting-${original.field}-roundtrip`;
						if (!options.mutations) {
							record({
								id,
								status: "skipped",
								reason: "mutations disabled",
							});
							continue;
						}
						const cap = caps.find((cap) => cap.field === original.field);
						assert(cap);
						const prefix =
							state.value.capabilities.transport === "v3"
								? [3, cap.valueId]
								: [cap.valueId];
						const bytes = (value: LightingChange) =>
							typeof value.value === "number"
								? [value.value]
								: [value.value.hue, value.value.saturation];
						const changed: LightingChange =
							typeof original.value === "number"
								? {
										field: original.field as
											| "brightness"
											| "effectSpeed"
											| "effect",
										value: (original.value + 41) % 256,
									}
								: {
										field: original.field as "color1" | "color2",
										value: {
											hue: (original.value.hue + 67) % 256,
											saturation: original.value.saturation === 255 ? 220 : 255,
										},
									};
						yield* step(
							id,
							restoring(
								Effect.gen(function* () {
									yield* lighting.setDesired(target, changed);
									const flushed = yield* lighting.flush(target);
									assert.deepEqual(
										flushed.applied.find(
											(value) => value.field === changed.field,
										),
										changed,
									);
								}),
								restoreLightingValue(
									device,
									connection,
									options.serial,
									prefix,
									bytes(original),
								),
							),
						);
					}
					yield* step(
						"lighting-all-originals-restored",
						lighting
							.select(target)
							.pipe(
								Effect.tap((actual) =>
									Effect.sync(() =>
										assert.deepEqual(actual.applied, originals),
									),
								),
							),
					);
					const before = writes;
					yield* step(
						"stale-lighting-target-rejected",
						Effect.gen(function* () {
							const result = yield* Effect.either(
								lighting.select({ ...target, session: "obsolete-acceptance" }),
							);
							assert(
								result._tag === "Left" &&
									result.left._tag === "LightingTargetUnavailable",
							);
							assert.equal(
								writes,
								before,
								"Stale target must not write to native HID",
							);
						}),
					);
				}).pipe(Effect.provide(sharedLighting(() => [session])));
				const protocol = yield* session.qmk([{ _tag: "protocol" }]);
				const version = (protocol[0]?.[0] ?? 0) * 256 + (protocol[0]?.[1] ?? 0);
				if (
					version === 12 &&
					initial.firmware?.deviceName === 3 &&
					initial.firmware.major === 1 &&
					initial.firmware.minor === 0 &&
					initial.firmware.patch === 19
				) {
					const v3 = yield* step(
						"v3-speed-restoration-and-readonly-state",
						probeV3Lighting(session, options.mutations, (prefix, values) =>
							restoreLightingValue(
								device,
								connection,
								options.serial,
								prefix,
								values,
							),
						).pipe(
							Effect.tap((rows) =>
								Effect.sync(() => {
									lightingQualification = {
										...lightingQualification,
										v3: rows,
									};
									assert(
										rows.every(
											(row) =>
												row.restored && (!row.mutated || row.appliedMatches),
										),
										"V3 lighting only echoes writes without applying values",
									);
								}),
							),
						),
					);
					if (Option.isSome(v3))
						lightingQualification = { ...lightingQualification, v3: v3.value };
				}
				yield* connection.disconnect();
				yield* step(
					"software-reconnect-stress",
					Effect.forEach(
						Array.from({ length: options.cycles }),
						(_, index) =>
							Effect.scoped(
								Effect.gen(function* () {
									const next = yield* device.connect({ path: info.path });
									const fresh = yield* controls.create(next, {
										serial: options.serial,
										session: `extended-cycle-${index}`,
									});
									yield* fresh.refresh();
									const actual = yield* fresh.snapshot();
									assert.equal(actual.mic, initial.mic);
									assert.equal(actual.luminance, initial.luminance);
									assert.equal(actual.available, true);
									yield* next.disconnect();
									const stale = yield* Effect.either(
										next.sendHardware({ _tag: "Query", feature: "mic" }),
									);
									assert(
										stale._tag === "Left" &&
											stale.left._tag === "QuakeConnectionClosed",
									);
								}),
							),
						{ discard: true },
					),
				);
			}),
		);
		yield* step(
			"all-native-handles-closed",
			Effect.sync(() => assert.equal(opens, closes)),
		);
		return {
			lightingQualification,
			checks: results,
			cycles: options.cycles,
			handlesOpened: opens,
			handlesClosed: closes,
			writes,
		};
	},
);
