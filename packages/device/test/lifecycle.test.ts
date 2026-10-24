import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Fiber,
	Layer,
	Queue,
	Stream,
	TestClock,
} from "effect";
import type { DeviceEvent } from "../src/device-contracts.js";
import { QuakeDevice } from "../src/device-service.js";
import { makeFakeHidTransport } from "../src/hid-fake.js";
import { HidTransport } from "../src/hid-transport.js";
import { report } from "./reports.js";

describe("device lifecycle", () => {
	it.scoped(
		"writes screen off/on through the connected handle and refuses writes after close",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				yield* Effect.gen(function* () {
					const connection = yield* QuakeDevice.connect();
					yield* connection.setScreenPower(false);
					yield* connection.setScreenPower(true);
					const writes = yield* fake.writes;
					expect(writes.map((bytes) => Array.from(bytes.slice(0, 7)))).toEqual([
						[0, 0xa3, 3, 1, 4, 0, 5],
						[0, 0xa3, 3, 1, 4, 1, 6],
					]);
					expect(yield* fake.opens).toBe(1);
					yield* connection.disconnect();
					const failed = yield* Effect.flip(connection.setScreenPower(false));
					expect(failed.code).toBe("QUAKE.HID.WRITE_FAILED");
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
			}),
	);
	it.scoped(
		"keeps the same handle after two EIOs and terminates on the third within ten seconds",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				let scans = 0;
				const transport = Layer.succeed(HidTransport, {
					...fake.transport,
					discover: () =>
						Effect.sync(() => {
							scans++;
						}).pipe(Effect.zipRight(fake.transport.discover())),
				});
				yield* Effect.gen(function* () {
					const connection = yield* QuakeDevice.connect();
					const stream = yield* connection.subscribe();
					const events = yield* Queue.unbounded<DeviceEvent>();
					const failed = yield* Deferred.make<string>();
					yield* Stream.runForEach(stream, (event) =>
						Queue.offer(events, event),
					).pipe(
						Effect.catchTag("QuakeHidReadFailed", (error) =>
							Deferred.succeed(failed, error.code),
						),
						Effect.forkScoped,
					);
					for (let index = 0; index < 2; index++) {
						yield* fake.failRead(
							Object.assign(new Error("private"), { code: "EIO" }),
						);
						yield* Effect.yieldNow();
						yield* fake.emit(report(3, 1, [1]));
						expect((yield* Queue.take(events))._tag).toBe("KnobRotate");
					}
					expect(yield* fake.opens).toBe(1);
					expect(yield* fake.closes).toBe(0);
					expect(scans).toBe(3);
					yield* fake.failRead(new Error("could not read from HID device"));
					expect((yield* Queue.take(events))._tag).toBe("Disconnect");
					expect(yield* Deferred.await(failed)).toBe("QUAKE.HID.READ_FAILED");
					expect(yield* fake.closes).toBe(1);
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(transport),
						),
					),
				);
			}),
	);
	it.scoped(
		"uses a rolling ten-second window and reconnects after the thirty-second fallback",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				yield* Effect.gen(function* () {
					const connection = yield* QuakeDevice.connect();
					const stream = yield* connection.subscribe();
					const fiber = yield* Stream.runDrain(stream).pipe(
						Effect.exit,
						Effect.forkScoped,
					);
					yield* fake.failRead(new Error("could not read from HID device"));
					yield* TestClock.adjust(10_000);
					yield* fake.failRead(new Error("could not read from HID device"));
					yield* TestClock.adjust(10_000);
					yield* fake.failRead(new Error("could not read from HID device"));
					yield* Effect.yieldNow();
					expect(yield* fake.closes).toBe(0);
					yield* TestClock.adjust(9999);
					expect(yield* fake.closes).toBe(0);
					yield* TestClock.adjust(1);
					yield* Fiber.join(fiber);
					expect(yield* fake.closes).toBe(1);
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
			}),
	);
});
