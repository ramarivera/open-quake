import { describe, expect, it } from "@effect/vitest";
import { HardwareControls, QuakeDevice } from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import { Effect, Layer } from "effect";
import { hardwareRequest } from "../hardware/controller";

describe("QUAKE calibration boundary", () => {
	it.scoped(
		"SETTINGS-072 refuses generic and ARIS commands before any hardware write",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHardwareTransport();
				const device = yield* QuakeDevice.pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
				const connection = yield* device.connect();
				const controls = yield* HardwareControls.pipe(
					Effect.provide(HardwareControls.Default),
				);
				const current = yield* controls.create(connection, {
					serial: "QUAKE-A",
					session: "session-A",
				});
				const before = yield* fake.writes;
				for (const command of [
					"calibrate",
					"ReportCalibrationData",
					"DoManualCalibration",
				]) {
					expect(
						yield* hardwareRequest(
							{ _tag: command, session: "session-A" },
							current,
							true,
						),
					).toEqual({
						_tag: "failure",
						code: "QUAKE.HARDWARE.INVALID_REQUEST",
					});
				}
				expect(yield* fake.writes).toEqual(before);
			}),
	);
});
