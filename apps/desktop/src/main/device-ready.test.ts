import {
	HardwareControls,
	type HardwareSession,
	QuakeDevice,
} from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import { Effect, Exit, Layer, Scope } from "effect";
import { expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

import { createDeviceReadyReader } from "./device-ready";
import type { DeviceBus } from "./deviceBus";

it("refreshes real hardware commands and returns one coherent serial/version/rotation snapshot", async () => {
	const scope = await Effect.runPromise(Scope.make());
	try {
		const hardware = await Effect.runPromise(
			Scope.extend(
				Effect.gen(function* () {
					const fake = yield* makeFakeHardwareTransport({ serial: "A" });
					const device = yield* QuakeDevice.pipe(
						Effect.provide(
							QuakeDevice.DefaultWithoutDependencies.pipe(
								Layer.provide(fake.layer),
							),
						),
					);
					const connection = yield* device.connect();
					return yield* (yield* HardwareControls.pipe(
						Effect.provide(HardwareControls.Default),
					)).create(connection, { serial: "A", session: "session-A" });
				}),
				scope,
			),
		);
		const bus: DeviceBus = {
			on: () => () => {},
			currentStatus: () => ({
				source: "mock",
				kind: "status",
				state: "connected",
			}),
			hardware: () => hardware,
		};
		const read = createDeviceReadyReader({
			bus: (serial) => (serial === "A" ? bus : undefined),
			rotation: () => 270,
			mock: true,
		});
		expect(await read("unknown")).toEqual({ _tag: "offline" });
		expect(await read("A")).toEqual({
			_tag: "ready",
			snapshot: {
				serialNumber: "A",
				connected: true,
				deviceModel: "QUAKE_HID",
				connectionType: "mock",
				session: "session-A",
				version: "1.0.21",
				rotation: 270,
				keyMatrix: { row: 2, col: 8 },
			},
		});
		const unknown = createDeviceReadyReader({
			bus: () => bus,
			rotation: () => undefined,
			mock: true,
		});
		const withoutDisplay = await unknown("A");
		expect(
			withoutDisplay._tag === "ready" && withoutDisplay.snapshot.rotation,
		).toBeUndefined();
	} finally {
		await Effect.runPromise(Scope.close(scope, Exit.void));
	}
});
it("suppresses an old serial/session reply when its device is replaced during refresh", async () => {
	let release = () => {};
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	let hardware: HardwareSession;
	const first = { refresh: () => Effect.promise(() => pending) };
	const second = { refresh: () => Effect.void };
	// Build the full session by using a real conductor, then override just the delayed refresh boundary.
	const scope = await Effect.runPromise(Scope.make());
	try {
		const real = await Effect.runPromise(
			Scope.extend(
				Effect.gen(function* () {
					const fake = yield* makeFakeHardwareTransport({ serial: "A" });
					const device = yield* QuakeDevice.pipe(
						Effect.provide(
							QuakeDevice.DefaultWithoutDependencies.pipe(
								Layer.provide(fake.layer),
							),
						),
					);
					return yield* (yield* HardwareControls.pipe(
						Effect.provide(HardwareControls.Default),
					)).create(yield* device.connect(), { serial: "A", session: "old" });
				}),
				scope,
			),
		);
		hardware = { ...real, ...first };
		const bus: DeviceBus = {
			on: () => () => {},
			currentStatus: () => ({
				source: "mock",
				kind: "status",
				state: "connected",
			}),
			hardware: () => hardware,
		};
		const read = createDeviceReadyReader({
			bus: () => bus,
			rotation: () => 0,
			mock: true,
		});
		const old = read("A");
		hardware = { ...real, ...second };
		release();
		expect(await old).toEqual({ _tag: "offline" });
	} finally {
		await Effect.runPromise(Scope.close(scope, Exit.void));
	}
});
