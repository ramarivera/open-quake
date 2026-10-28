import { expect, it } from "@effect/vitest";
import { HardwareControls, QuakeDevice } from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import {
	Deferred,
	Effect,
	Fiber,
	Layer,
	Option,
	Stream,
	TestClock,
} from "effect";
import { HidTransport } from "../../../../../packages/device/src/hid-transport";
import { LightingService } from "../../../../../packages/device/src/lighting/lighting-service";
import { sharedLighting } from "./qmk-lighting";

// Hold the first brightness reply in the actual fake HID report stream, after its
// write has completed. Hardware refresh, QMK resolution and later reads stay real.
const setup = (
	serial = "A",
	holdReply = true,
	options: Parameters<typeof makeFakeHardwareTransport>[0] = {},
) =>
	Effect.gen(function* () {
		const fake = yield* makeFakeHardwareTransport({ serial, ...options });
		const waiting = yield* Deferred.make<Uint8Array>();
		let held = false;
		const transport = {
			...fake.transport,
			open: (info: Parameters<typeof fake.transport.open>[0]) =>
				fake.transport.open(info).pipe(
					Effect.map((handle) => ({
						...handle,
						reports: handle.reports.pipe(
							Stream.filterEffect((report) => {
								if (holdReply && !held && report[0] === 8 && report[1] === 9) {
									held = true;
									return Deferred.succeed(waiting, report).pipe(
										Effect.as(false),
									);
								}
								return Effect.succeed(true);
							}),
						),
					})),
				),
		};
		const device = yield* QuakeDevice.pipe(
			Effect.provide(
				QuakeDevice.DefaultWithoutDependencies.pipe(
					Layer.provide(Layer.succeed(HidTransport, transport)),
				),
			),
		);
		const connection = yield* device.connect();
		const controls = yield* HardwareControls.pipe(
			Effect.provide(HardwareControls.Default),
		);
		const session = yield* controls.create(connection, {
			serial,
			session: "a1",
		});
		yield* session.refresh();
		return {
			fake,
			connection,
			session,
			waiting,
			reply: Deferred.await(waiting).pipe(Effect.flatMap(fake.emit)),
		};
	});

for (const replacement of ["refresh", "target", "deselect"] as const) {
	it.scoped(
		`shared fake-HID lighting ${replacement} drains a written initial read without disconnecting hardware`,
		() =>
			Effect.gen(function* () {
				const f = yield* setup();
				const b =
					replacement === "target" ? yield* setup("B", false) : undefined;
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					const target = { serial: "A", session: "a1" };
					const initial = yield* lighting
						.select(target)
						.pipe(Effect.either, Effect.fork);
					yield* Deferred.await(f.waiting);
					const replacing = yield* (
						replacement !== "deselect"
							? lighting.select(b ? { serial: "B", session: "a1" } : target)
							: lighting.deselect()
					).pipe(Effect.fork);
					yield* TestClock.adjust(0);
					expect(Option.isNone(yield* Fiber.poll(initial))).toBe(true);
					expect(yield* f.fake.closes).toBe(0);
					yield* f.reply;
					expect((yield* Fiber.join(initial))._tag).toBe("Left");
					yield* Fiber.join(replacing);
					if (replacement === "deselect") yield* lighting.select(target);
					expect(yield* lighting.state()).toMatchObject({
						value: { status: "ready" },
					});
					yield* f.session.toggleMic();
					expect(yield* f.session.snapshot()).toMatchObject({
						available: true,
						mic: false,
					});
					expect(yield* f.fake.opens).toBe(1);
					expect(yield* f.fake.closes).toBe(0);
				}).pipe(
					Effect.provide(
						sharedLighting(() => (b ? [f.session, b.session] : [f.session])),
					),
				);
			}),
	);
}

it.scoped(
	"shared raw cancellation drains only the started exchange and cancels an unwritten queued operation",
	() =>
		Effect.gen(function* () {
			const f = yield* setup();
			const read = yield* f.session
				.qmk([{ _tag: "get", prefix: [9], length: 1 }])
				.pipe(Effect.fork);
			yield* Deferred.await(f.waiting);
			const count = (yield* f.fake.writes).length;
			const queued = yield* f.session
				.qmk([{ _tag: "get", prefix: [11], length: 1 }])
				.pipe(Effect.fork);
			yield* TestClock.adjust(0);
			yield* Fiber.interrupt(queued);
			expect(yield* f.fake.writes).toHaveLength(count);
			const cancelling = yield* Fiber.interrupt(read).pipe(Effect.fork);
			yield* TestClock.adjust(0);
			expect(Option.isNone(yield* Fiber.poll(cancelling))).toBe(true);
			yield* f.reply;
			yield* Fiber.join(cancelling);
			yield* f.session.toggleMic();
			expect((yield* f.session.snapshot()).available).toBe(true);
			expect(yield* f.fake.closes).toBe(0);
		}),
);

it.scoped(
	"a missing shared lighting reply still fails at 1500ms and closes the device",
	() =>
		Effect.gen(function* () {
			const f = yield* setup();
			yield* Effect.gen(function* () {
				const lighting = yield* LightingService;
				const reading = yield* lighting
					.select({ serial: "A", session: "a1" })
					.pipe(Effect.either, Effect.fork);
				yield* Deferred.await(f.waiting);
				yield* TestClock.adjust(1499);
				expect(Option.isNone(yield* Fiber.poll(reading))).toBe(true);
				expect(yield* f.fake.closes).toBe(0);
				yield* TestClock.adjust(1);
				expect((yield* Fiber.join(reading))._tag).toBe("Left");
				yield* f.connection.disconnect();
				expect(yield* f.fake.closes).toBe(1);
				expect((yield* f.session.snapshot()).available).toBe(false);
			}).pipe(Effect.provide(sharedLighting(() => [f.session])));
		}),
);

it.scoped(
	"genuine disconnect settles a draining shared read without waiting for the deadline",
	() =>
		Effect.gen(function* () {
			const f = yield* setup();
			const read = yield* f.session
				.qmk([{ _tag: "get", prefix: [9], length: 1 }])
				.pipe(Effect.either, Effect.fork);
			yield* Deferred.await(f.waiting);
			yield* f.connection.disconnect();
			expect((yield* Fiber.join(read))._tag).toBe("Left");
			expect(yield* f.fake.closes).toBe(1);
			expect((yield* f.session.snapshot()).available).toBe(false);
		}),
);

it.scoped("native write failure still stops a shared raw exchange", () =>
	Effect.gen(function* () {
		const f = yield* setup();
		yield* f.fake.failWrite(new Error("synthetic write failure"));
		expect(
			(yield* f.session.qmk([{ _tag: "protocol" }]).pipe(Effect.either))._tag,
		).toBe("Left");
		yield* f.connection.disconnect();
		expect(yield* f.fake.closes).toBe(1);
		expect((yield* f.session.snapshot()).available).toBe(false);
	}),
);

it.scoped(
	"cancelling a sent shared read cannot suppress its 1500ms timeout or connection failure",
	() =>
		Effect.gen(function* () {
			const f = yield* setup();
			const read = yield* f.session
				.qmk([{ _tag: "get", prefix: [9], length: 1 }])
				.pipe(Effect.fork);
			yield* Deferred.await(f.waiting);
			const cancelling = yield* Fiber.interrupt(read).pipe(Effect.fork);
			yield* TestClock.adjust(1499);
			expect(Option.isNone(yield* Fiber.poll(cancelling))).toBe(true);
			expect(yield* f.fake.closes).toBe(0);
			yield* TestClock.adjust(1);
			yield* Fiber.join(cancelling);
			yield* f.connection.disconnect();
			expect(yield* f.fake.closes).toBe(1);
			expect((yield* f.session.snapshot()).available).toBe(false);
		}),
);

const v3Options = {
	firmware: [3, 1, 0, 19] as const,
	qmkProtocolVersion: 12,
	qmkValues: [{ prefix: [3, 3], values: [156] }],
};
it.scoped(
	"qualified V3 reads, applies and restores only speed on the existing handle",
	() =>
		Effect.gen(function* () {
			const f = yield* setup("A", false, v3Options);
			yield* Effect.gen(function* () {
				const lighting = yield* LightingService;
				const target = { serial: "A", session: "a1" };
				const selected = yield* lighting.select(target);
				expect(selected.status).toBe("ready");
				expect(selected.capabilities.transport).toBe("v3");
				expect(selected.capabilities.fields).toMatchObject([
					{
						field: "effectSpeed",
						valueId: 3,
						evidence: { basis: "hardware-qualified" },
					},
				]);
				expect(selected.applied).toEqual([
					{ field: "effectSpeed", value: 156 },
				]);
				expect(Option.isNone(selected.capabilities.save)).toBe(true);
				const before = (yield* f.fake.writes).length;
				for (const change of [
					{ field: "brightness", value: 20 },
					{ field: "effect", value: 1 },
					{ field: "color1", value: { hue: 1, saturation: 255 } },
					{ field: "color2", value: { hue: 1, saturation: 255 } },
				]) {
					const result = yield* lighting
						.setDesired(target, change)
						.pipe(Effect.either);
					expect(result).toMatchObject({
						_tag: "Left",
						left: { _tag: "LightingValueUnsupported" },
					});
				}
				expect(yield* lighting.save(target).pipe(Effect.either)).toMatchObject({
					_tag: "Left",
					left: { _tag: "LightingValueUnsupported" },
				});
				expect((yield* f.fake.writes).length).toBe(before);
				for (const value of [187, 156]) {
					yield* lighting.setDesired(target, { field: "effectSpeed", value });
					expect((yield* lighting.flush(target)).applied).toEqual([
						{ field: "effectSpeed", value },
					]);
				}
				const writes = yield* f.fake.writes;
				expect(
					writes
						.filter((b) => b[1] === 7)
						.map((b) => Array.from(b.slice(1, 5))),
				).toEqual([
					[7, 3, 3, 187],
					[7, 3, 3, 156],
				]);
				expect(
					writes
						.filter((b) => b[1] === 8)
						.every((b) => b[2] === 3 && b[3] === 3),
				).toBe(true);
				expect(writes.some((b) => b[1] === 9)).toBe(false);
				expect(yield* f.fake.opens).toBe(1);
				expect(yield* f.fake.closes).toBe(0);
				yield* lighting.deselect();
				expect(
					yield* lighting
						.setDesired(target, { field: "effectSpeed", value: 99 })
						.pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { _tag: "LightingTargetUnavailable" },
				});
				expect(yield* f.fake.writes).toEqual(writes);
			}).pipe(Effect.provide(sharedLighting(() => [f.session])));
		}),
);
for (const mismatch of [
	{ ...v3Options, qmkProtocolVersion: 11 },
	{ ...v3Options, qmkProtocolVersion: 13 },
	{ ...v3Options, firmware: [3, 1, 0, 20] as const },
	{ ...v3Options, firmware: [1, 1, 0, 19] as const },
]) {
	it.scoped(
		`does not qualify nearby V3 identity ${JSON.stringify(mismatch.firmware)}/${mismatch.qmkProtocolVersion}`,
		() =>
			Effect.gen(function* () {
				const f = yield* setup("A", false, mismatch);
				yield* Effect.gen(function* () {
					const lighting = yield* LightingService;
					const state = yield* lighting.select({ serial: "A", session: "a1" });
					expect(state.status).toBe("unavailable");
					expect(state.capabilities.fields).toEqual([]);
					expect(
						(yield* f.fake.writes).some(
							(b) => b[1] === 7 || b[1] === 8 || b[1] === 9,
						),
					).toBe(false);
				}).pipe(Effect.provide(sharedLighting(() => [f.session])));
			}),
	);
}
