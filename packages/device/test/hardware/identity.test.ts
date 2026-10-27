import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { QuakeDevice } from "../../src/device-service.js";
import { FAKE_QUAKE_DEVICE, makeFakeHidTransport } from "../../src/hid-fake.js";
import { HidTransport } from "../../src/hid-transport.js";

it.effect(
	"MGMT-406 Linux hidraw discovery requires every identity field and a nonblank stable serial",
	() =>
		Effect.gen(function* () {
			const valid = {
				...FAKE_QUAKE_DEVICE,
				path: "/dev/hidraw6",
				serialNumber: "AA:BB",
			};
			const fake = yield* makeFakeHidTransport([
				valid,
				{ ...valid, vendorId: 0x1234 },
				{ ...valid, productId: 0x1234 },
				{ ...valid, usagePage: 1 },
				{ ...valid, usage: 6 },
				{ ...valid, serialNumber: "" },
				{ ...valid, serialNumber: " : " },
				{
					path: "/dev/hidraw9",
					vendorId: 0x4158,
					productId: 0x514b,
					usagePage: 0xff60,
					usage: 0x61,
				},
			]);
			const device = yield* QuakeDevice.pipe(
				Effect.provide(
					QuakeDevice.DefaultWithoutDependencies.pipe(
						Layer.provide(fake.layer),
					),
				),
			);
			expect(yield* device.discover()).toEqual([
				{ ...valid, serialNumber: "AABB" },
			]);
			expect(yield* fake.opens).toBe(0);
		}),
);
it.effect(
	"MGMT-406 duplicate canonical serials fail closed before any handle opens",
	() =>
		Effect.gen(function* () {
			const fake = yield* makeFakeHidTransport([
				{ ...FAKE_QUAKE_DEVICE, serialNumber: "AA:BB" },
				{ ...FAKE_QUAKE_DEVICE, path: "/dev/hidraw2", serialNumber: "AABB" },
			]);
			const device = yield* QuakeDevice.pipe(
				Effect.provide(
					QuakeDevice.DefaultWithoutDependencies.pipe(
						Layer.provide(fake.layer),
					),
				),
			);
			const result = yield* device.discover().pipe(Effect.either);
			expect(result._tag === "Left" && result.left.code).toBe(
				"QUAKE.HID.DISCOVERY_FAILED",
			);
			expect(yield* fake.opens).toBe(0);
		}),
);
it.scoped(
	"MGMT-406 a changed hidraw path retains serial ownership and closes its predecessor",
	() =>
		Effect.gen(function* () {
			let path = "/dev/hidraw1";
			const fake = yield* makeFakeHidTransport([
				{ ...FAKE_QUAKE_DEVICE, path },
				{ ...FAKE_QUAKE_DEVICE, path: "/dev/hidraw7" },
			]);
			const transport = {
				...fake.transport,
				discover: () => Effect.succeed([{ ...FAKE_QUAKE_DEVICE, path }]),
			};
			const device = yield* QuakeDevice.pipe(
				Effect.provide(
					QuakeDevice.DefaultWithoutDependencies.pipe(
						Layer.provide(Layer.succeed(HidTransport, transport)),
					),
				),
			);
			const old = yield* device.connect();
			path = "/dev/hidraw7";
			const next = yield* device.connect();
			expect(next.info.serialNumber).toBe(old.info.serialNumber);
			expect(yield* fake.closes).toBe(1);
			expect(
				(yield* old
					.sendHardware({ _tag: "Mic", on: false })
					.pipe(Effect.either))._tag,
			).toBe("Left");
		}),
);
