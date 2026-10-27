import { encodeQmkCommand } from "@open-quake/protocol";
import { Effect, Either, Exit, Layer, Stream } from "effect";
import { expect, it, vi } from "vitest";
import { QuakeDevice } from "../../../../../../packages/device/src/device-service.js";
import { makeFakeHardwareTransport } from "../../../../../../packages/device/src/hardware/hardware-fake.js";
import { HardwareControls } from "../../../../../../packages/device/src/hardware/hardware-service.js";
import { HidTransport } from "../../../../../../packages/device/src/hid-transport.js";
import { restoring } from "./consumer.js";
import { runExtendedAcceptance } from "./extended.js";
import { allowedExtendedWrite } from "./policy.js";
import { restoreLightingValue } from "./restore-lighting.js";
import { probeV3Lighting } from "./v3-lighting.js";

vi.mock("node-hid", () => {
	throw new Error("Default tests must not load native HID");
});

it.each([false, true])(
	"runs supplemental production lighting and reconnect consumers, mutations=%s",
	async (mutations) => {
		const fake = await Effect.runPromise(
			makeFakeHardwareTransport({ serial: "private-extended-device" }),
		);
		const report = await Effect.runPromise(
			runExtendedAcceptance({
				serial: "private-extended-device",
				mutations,
				cycles: 3,
			}).pipe(Effect.provide(fake.layer)),
		);
		expect(report.checks.filter((item) => item.status === "failed")).toEqual(
			[],
		);
		expect(report.handlesOpened).toBe(4);
		expect(report.handlesClosed).toBe(report.handlesOpened);
		expect(
			report.checks
				.filter((item) => item.id.endsWith("roundtrip"))
				.map((item) => item.status),
		).toEqual(Array(3).fill(mutations ? "passed" : "skipped"));
		expect(JSON.stringify(report)).not.toContain("private-extended-device");
		const writes = await Effect.runPromise(fake.writes);
		expect(
			writes.every((bytes) => allowedExtendedWrite(bytes, mutations)),
		).toBe(true);
		expect(writes.some((bytes) => bytes[1] === 9)).toBe(false);
	},
);

it("refuses lighting save, unqualified fields and malformed native writes", () => {
	for (const command of [
		{ command: 9 },
		{ command: 7, lightingValue: 10, values: [1] },
		{ command: 8, lightingValue: 13, resultLength: 2 },
	] as const) {
		const bytes = Either.getOrThrow(encodeQmkCommand(command));
		expect(allowedExtendedWrite(bytes, true)).toBe(false);
	}
	const set = Either.getOrThrow(
		encodeQmkCommand({ command: 7, lightingValue: 9, values: [120] }),
	);
	expect(allowedExtendedWrite(set, false)).toBe(false);
	expect(allowedExtendedWrite(set, true)).toBe(true);
	set[32] = 1;
	expect(allowedExtendedWrite(set, true)).toBe(false);
});

it.each([false, true])(
	"verifies V3 speed restoration through the production QMK owner, corrupt applied readback=%s",
	async (corrupt) => {
		const fake = await Effect.runPromise(
			makeFakeHardwareTransport({
				qmkProtocolVersion: 12,
				qmkValues: [
					{ prefix: [3, 1], values: [247] },
					{ prefix: [3, 2], values: [0] },
					{ prefix: [3, 3], values: [156] },
					{ prefix: [3, 4], values: [0, 255] },
				],
			}),
		);
		let sets = 0,
			corrupted = false;
		const transport = Layer.succeed(HidTransport, {
			...fake.transport,
			open: (info) =>
				fake.transport.open(info).pipe(
					Effect.map((handle) => ({
						...handle,
						write: (bytes) =>
							Effect.sync(() => {
								if (bytes[1] === 7 && bytes[2] === 3 && bytes[3] === 3) sets++;
							}).pipe(Effect.zipRight(handle.write(bytes))),
						reports: handle.reports.pipe(
							Stream.map((report) => {
								if (
									corrupt &&
									!corrupted &&
									sets === 1 &&
									report[0] === 8 &&
									report[1] === 3 &&
									report[2] === 3
								) {
									corrupted = true;
									const changed = report.slice();
									changed[3] = 99;
									return changed;
								}
								return report;
							}),
						),
					})),
				),
		});
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const device = yield* QuakeDevice.pipe(
						Effect.provide(
							QuakeDevice.DefaultWithoutDependencies.pipe(
								Layer.provide(transport),
							),
						),
					);
					const connection = yield* device.connect();
					const controls = yield* HardwareControls.pipe(
						Effect.provide(HardwareControls.Default),
					);
					const session = yield* controls.create(connection, {
						serial: "private-v3-sentinel",
						session: "test",
					});
					yield* session.refresh();
					const result = yield* Effect.exit(probeV3Lighting(session, true));
					expect(Exit.isFailure(result)).toBe(corrupt);
					if (Exit.isSuccess(result))
						expect(
							result.value.filter((row) => row.mutated).map((row) => row.field),
						).toEqual(["effectSpeed"]);
					const readback = yield* session.qmk([
						{ _tag: "get", prefix: [3, 3], length: 1 },
						{ _tag: "get", prefix: [3, 2], length: 1 },
					]);
					expect(readback).toEqual([[156], [0]]);
				}),
			),
		);
		const writes = await Effect.runPromise(fake.writes);
		expect(writes.every((bytes) => allowedExtendedWrite(bytes, true))).toBe(
			true,
		);
		expect(
			writes
				.filter((bytes) => bytes[1] === 7)
				.map((bytes) => Array.from(bytes.slice(1, 5))),
		).toEqual([
			[7, 3, 3, 187],
			[7, 3, 3, 156],
		]);
	},
);

it("keeps unqualified V3 brightness, effect and color writes blocked", () => {
	for (const field of [1, 2, 4]) {
		const bytes = new Uint8Array(33);
		bytes.set([0, 7, 3, field, 1]);
		expect(allowedExtendedWrite(bytes, true)).toBe(false);
	}
});

it("restores a changed lighting value after a lost ACK poisons controls and closes the connection", async () => {
	const fake = await Effect.runPromise(makeFakeHardwareTransport());
	let dropped = false;
	const transport = Layer.succeed(HidTransport, {
		...fake.transport,
		open: (info) =>
			fake.transport.open(info).pipe(
				Effect.map((handle) => ({
					...handle,
					reports: handle.reports.pipe(
						Stream.filter((report) => {
							if (!dropped && report[0] === 7 && report[1] === 11) {
								dropped = true;
								return false;
							}
							return true;
						}),
					),
				})),
			),
	});
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const device = yield* QuakeDevice.pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(transport),
						),
					),
				);
				const connection = yield* device.connect();
				const controls = yield* HardwareControls.pipe(
					Effect.provide(HardwareControls.Default),
				);
				const session = yield* controls.create(connection, {
					serial: "mock-quake",
					session: "failure",
				});
				yield* session.refresh();
				const result = yield* Effect.exit(
					restoring(
						session.qmk([{ _tag: "set", prefix: [11], values: [187] }]),
						restoreLightingValue(device, connection, "mock-quake", [11], [100]),
					),
				);
				expect(Exit.isFailure(result)).toBe(true);
				expect(
					(yield* session.qmk([{ _tag: "protocol" }]).pipe(Effect.either))._tag,
				).toBe("Left");
				const writes = yield* fake.writes;
				expect(
					writes
						.filter((b) => b[1] === 7)
						.map((b) => Array.from(b.slice(1, 4))),
				).toEqual([
					[7, 11, 187],
					[7, 11, 100],
				]);
				expect(Array.from(writes.at(-1)?.slice(1, 3) ?? [])).toEqual([8, 11]);
				expect(yield* fake.opens).toBe(2);
				expect(yield* fake.closes).toBe(2);
			}),
		),
	);
});
