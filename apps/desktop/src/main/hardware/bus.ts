import { randomUUID } from "node:crypto";
import {
	HardwareControls,
	type QuakeConnection,
	QuakeDevice,
} from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import { Effect, Layer } from "effect";
import type { DeviceBus } from "../deviceBus";
import { startMockDeviceBus } from "../mockDeviceBus";

export const attachHardware = (
	controls: HardwareControls,
	connection: QuakeConnection,
) =>
	controls.create(connection, {
		serial: connection.info.serialNumber ?? "",
		session: randomUUID(),
	});

/** Synthetic events plus a real codec/conductor path backed only by fake HID. */
export const startMockHardwareBus = Effect.fn("MockHardwareBus.start")(
	function* (scripted = true) {
		const bus = yield* Effect.acquireRelease(
			Effect.sync(() => startMockDeviceBus(scripted)),
			(bus) => Effect.sync(() => bus.stop()),
		);
		const fake = yield* makeFakeHardwareTransport();
		const device = yield* QuakeDevice.pipe(
			Effect.provide(
				QuakeDevice.DefaultWithoutDependencies.pipe(Layer.provide(fake.layer)),
			),
		);
		const connection = yield* device.connect();
		const controls = yield* HardwareControls;
		const hardware = yield* attachHardware(controls, connection);
		yield* hardware.refresh();
		return { ...bus, hardware: () => hardware } satisfies DeviceBus;
	},
);
