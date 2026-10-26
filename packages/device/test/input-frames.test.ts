import { describe, expect, it } from "@effect/vitest";
import { Chunk, Effect, Either, Fiber, Layer, Stream, TestClock } from "effect";
import {
	canonicalHidSerial,
	hidSerialFromAlias,
	wsSerialFromHid,
} from "../src/device-contracts.js";
import { QuakeHidWriteFailed } from "../src/device-errors.js";
import { QuakeDevice } from "../src/device-service.js";
import { FAKE_QUAKE_DEVICE, makeFakeHidTransport } from "../src/hid-fake.js";
import { HidTransport } from "../src/hid-transport.js";

// Independent fixtures, deliberately not built with production frame encoders.
const physical = (bytes: readonly number[]) => {
	const report = new Uint8Array(32);
	report.set(bytes);
	return report;
};
const a1 = physical([0xa1, 0, 7, 123, 34, 120, 34, 58, 49, 125, 33]); // {"x":1}, sum %255 =33
const resourceBody = [
	2,
	1,
	2,
	3,
	0,
	0,
	0,
	...Array.from({ length: 40 }, (_, i) => i),
];
const a2 = [
	0xa2,
	0,
	47,
	...resourceBody,
	resourceBody.reduce((a, b) => a + b, 0) % 255,
];
const matrix = physical([1, 0, 0, 0, 0, 1]);

describe("live independent input frames", () => {
	it.scoped(
		"MAIN-008 rejects corrupt A1 and truncated A2 on the live stream",
		() =>
			Effect.gen(function* () {
				for (const mode of ["checksum", "truncated"] as const) {
					const fake = yield* makeFakeHidTransport();
					yield* Effect.scoped(
						Effect.gen(function* () {
							const connection = yield* (yield* QuakeDevice).connect();
							const stream = yield* connection.subscribe();
							const reading = yield* Stream.runCollect(stream).pipe(
								Effect.either,
								Effect.forkScoped,
							);
							if (mode === "checksum") {
								const corrupt = a1.slice();
								corrupt[10] = 0;
								yield* fake.emit(corrupt);
							} else {
								yield* fake.emit(physical(a2.slice(0, 32)));
								yield* fake.end();
							}
							const result = yield* Fiber.join(reading);
							expect(Either.isLeft(result)).toBe(true);
							expect(yield* fake.closes).toBe(1);
						}),
					).pipe(
						Effect.provide(
							QuakeDevice.DefaultWithoutDependencies.pipe(
								Layer.provide(fake.layer),
							),
						),
					);
				}
			}),
	);
	it.scoped(
		"MAIN-008 discards partial assembly when the serial reconnects",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport([
					{ ...FAKE_QUAKE_DEVICE, serialNumber: "A" },
				]);
				yield* Effect.gen(function* () {
					const device = yield* QuakeDevice;
					const first = yield* device.connect();
					yield* fake.emit(physical(a2.slice(0, 32)));
					yield* TestClock.adjust(0);
					yield* first.disconnect();
					const next = yield* device.connect();
					const stream = yield* next.subscribe();
					const reading = yield* Stream.runCollect(
						stream.pipe(Stream.take(1)),
					).pipe(Effect.forkScoped);
					yield* fake.emit(a1);
					expect(Chunk.toReadonlyArray(yield* Fiber.join(reading))).toEqual([
						{ _tag: "Json", value: { x: 1 } },
					]);
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
		"dispatches A1, assembled A2 and matrix in order through the read consumer",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				yield* Effect.gen(function* () {
					const connection = yield* (yield* QuakeDevice).connect();
					const stream = yield* connection.subscribe();
					const collected = yield* Stream.runCollect(
						stream.pipe(Stream.take(3)),
					).pipe(Effect.forkScoped);
					yield* fake.emit(a1);
					yield* fake.emit(physical(a2.slice(0, 32)));
					yield* fake.emit(physical(a2.slice(32)));
					yield* fake.emit(matrix);
					const events = Chunk.toReadonlyArray(yield* Fiber.join(collected));
					expect(events).toMatchObject([
						{ _tag: "Json", value: { x: 1 } },
						{
							_tag: "Resource",
							envelope: {
								opCode: 2,
								metadata: [1, 2, 3, 0, 0],
								sequence: 0,
								payload: Array.from({ length: 40 }, (_, i) => i),
							},
						},
						{
							_tag: "Matrix",
							matrix: { states: [0, 1, ...Array(13).fill(0)] },
						},
					]);
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
		"bounds initial keepalive retries and cancels further writes on disconnect",
		() =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHidTransport();
				let attempts = 0;
				const layer = Layer.succeed(HidTransport, {
					...fake.transport,
					open: (info) =>
						fake.transport.open(info).pipe(
							Effect.map((handle) => ({
								...handle,
								write: (bytes) =>
									Effect.suspend(() =>
										++attempts < 4
											? Effect.fail(new QuakeHidWriteFailed(undefined))
											: handle.write(bytes),
									),
							})),
						),
				});
				yield* Effect.gen(function* () {
					const connection = yield* (yield* QuakeDevice).connect();
					yield* TestClock.adjust(999);
					expect(attempts).toBe(0);
					yield* TestClock.adjust(1);
					expect(attempts).toBe(1);
					yield* TestClock.adjust(1499);
					expect(attempts).toBe(3);
					yield* TestClock.adjust(1);
					expect(attempts).toBe(4);
					yield* TestClock.adjust(14999);
					expect(attempts).toBe(4);
					yield* TestClock.adjust(1);
					expect(attempts).toBe(5);
					yield* connection.disconnect();
					yield* TestClock.adjust(30000);
					expect(attempts).toBe(5);
				}).pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(Layer.provide(layer)),
					),
				);
			}),
	);
	it.scoped("replaces same serial and rejects normalized collisions", () =>
		Effect.gen(function* () {
			const fake = yield* makeFakeHidTransport([
				{ ...FAKE_QUAKE_DEVICE, serialNumber: "AB:CD" },
			]);
			yield* Effect.gen(function* () {
				const device = yield* QuakeDevice;
				const one = yield* device.connect();
				const two = yield* device.connect();
				expect(one.info.serialNumber).toBe("ABCD");
				expect(yield* fake.closes).toBe(1);
				yield* two.disconnect();
				expect(yield* fake.closes).toBe(2);
			}).pipe(
				Effect.provide(
					QuakeDevice.DefaultWithoutDependencies.pipe(
						Layer.provide(fake.layer),
					),
				),
			);
			const collision = yield* makeFakeHidTransport([
				{ ...FAKE_QUAKE_DEVICE, serialNumber: "AB:CD" },
				{ ...FAKE_QUAKE_DEVICE, path: "other", serialNumber: "ABCD" },
			]);
			const result = yield* QuakeDevice.discover().pipe(
				Effect.either,
				Effect.provide(
					QuakeDevice.DefaultWithoutDependencies.pipe(
						Layer.provide(collision.layer),
					),
				),
			);
			expect(result._tag === "Left" && result.left._tag).toBe(
				"QuakeHidDiscoveryFailed",
			);
		}),
	);
	it("round trips aliases without changing native ws_ serials", () => {
		expect(canonicalHidSerial("AB:CD")).toBe("ABCD");
		expect(hidSerialFromAlias(wsSerialFromHid("AB:CD"))).toBe("ABCD");
		expect(hidSerialFromAlias(wsSerialFromHid("ws_AB"))).toBe("ws_AB");
	});
});
