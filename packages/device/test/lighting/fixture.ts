import { Effect, Layer, Option } from "effect";
import { QUAKE_IDENTITY } from "../../src/device-contracts.js";
import type { QuakeHidWriteFailed } from "../../src/device-errors.js";
import { makeFakeHidTransport } from "../../src/hid-fake.js";
import { HidTransport } from "../../src/hid-transport.js";
import {
	type LightingCapabilities,
	LightingDevice,
	type LightingRegistration,
	LightingService,
	LightingTargetRegistry,
} from "../../src/lighting/index.js";

export const targetA = { serial: "QUAKE-A", session: "session-a" };
export const targetB = { serial: "QUAKE-B", session: "session-b" };
export const identity = { firmware: "fixture-1.0.19", protocolVersion: 10 };
export const evidence = { identity, basis: "hid-fake" } as const;
const access = { readable: true, writable: true, evidence };
export const capabilities: LightingCapabilities = {
	target: targetA,
	identity,
	transport: "legacy",
	fields: [
		{ ...access, field: "brightness", valueId: 9, range: { min: 0, max: 200 } },
		{ ...access, field: "effect", valueId: 10, effectIds: [0, 2, 7] },
		{
			...access,
			field: "effectSpeed",
			valueId: 11,
			range: { min: 0, max: 255 },
		},
		{
			...access,
			field: "color1",
			valueId: 12,
			hue: { min: 0, max: 255 },
			saturation: { min: 0, max: 255 },
		},
	],
	save: Option.some({ evidence, completion: "ack-and-readback" }),
};

export const makeFixture = (capsA: LightingCapabilities = capabilities) =>
	Effect.gen(function* () {
		const responseScope = yield* Effect.scope;
		const infoA = { ...QUAKE_IDENTITY, path: "private:hid-a" };
		const infoB = { ...QUAKE_IDENTITY, path: "private:hid-b" };
		const fakeA = yield* makeFakeHidTransport([infoA]);
		const fakeB = yield* makeFakeHidTransport([infoB]);
		const registrations = new Map<string, LightingRegistration>([
			[targetA.serial, { info: infoA, capabilities: capsA }],
			[
				targetB.serial,
				{ info: infoB, capabilities: { ...capabilities, target: targetB } },
			],
		]);
		const valuesA = new Map<number, readonly number[]>([
			[9, [20]],
			[10, [2]],
			[11, [40]],
			[12, [60, 80]],
			[13, [90, 100]],
		]);
		const valuesB = new Map(valuesA);
		// A hook can delay/drop/fail one response while retaining real fake HID writes.
		const control = {
			write: (
				_bytes: Uint8Array,
				write: Effect.Effect<void, QuakeHidWriteFailed>,
			): Effect.Effect<void, QuakeHidWriteFailed> => write,
			hook: (
				_bytes: Uint8Array,
				reply: Effect.Effect<void>,
			): Effect.Effect<void, QuakeHidWriteFailed> => reply,
		};
		const transport = Layer.succeed(HidTransport, {
			discover: () =>
				Effect.succeed([
					infoB,
					infoA,
					{ ...infoA, path: "unrelated-keyboard", vendorId: 0 },
				]),
			open: (info) =>
				Effect.gen(function* () {
					const fake = info.path === infoA.path ? fakeA : fakeB;
					const values = info.path === infoA.path ? valuesA : valuesB;
					const handle = yield* fake.transport.open(info);
					return {
						...handle,
						write: (bytes: Uint8Array) =>
							Effect.gen(function* () {
								yield* control.write(bytes, handle.write(bytes));
								const command = bytes[1];
								const valueId = bytes[2] ?? 0;
								if (command === 7)
									values.set(
										valueId,
										Array.from(
											bytes.slice(
												3,
												valueId === 12 || valueId === 13 || valueId === 131
													? 5
													: 4,
											),
										),
									);
								const response =
									command === 1
										? [1, 0, 10]
										: command === 8
											? [8, valueId, ...(values.get(valueId) ?? [0])]
											: Array.from(bytes.slice(1));
								const report = new Uint8Array(32);
								report.set(response);
								yield* control
									.hook(bytes, fake.emit(report))
									.pipe(Effect.interruptible, Effect.forkIn(responseScope));
							}),
					};
				}),
		});
		const registry = Layer.succeed(LightingTargetRegistry, {
			resolve: (target) =>
				Effect.sync(() => {
					const current = registrations.get(target.serial);
					return current?.capabilities.target.session === target.session
						? Option.some(current)
						: Option.none();
				}),
		});
		const layer = LightingService.DefaultWithoutDependencies.pipe(
			Layer.provide(
				LightingDevice.DefaultWithoutDependencies.pipe(
					Layer.provide(Layer.mergeAll(transport, registry)),
				),
			),
		);
		return { layer, fakeA, fakeB, valuesA, valuesB, registrations, control };
	});
