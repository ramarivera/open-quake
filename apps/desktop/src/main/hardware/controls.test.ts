import { expect, it } from "@effect/vitest";
import { QuakeDevice } from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import { Effect, Fiber, Layer, Schema, TestClock } from "effect";
import { createActionDraft } from "../../../../../packages/device/src/actions/action-registry";
import {
	executeHardwareKey,
	HardwareKeyConfig,
} from "../../../../../packages/device/src/hardware/hardware-actions";
import { HardwareControls } from "../../../../../packages/device/src/hardware/hardware-service";
import { LightingService } from "../../../../../packages/device/src/lighting/lighting-service";
import { hostKeyboardAdapter } from "./host-keyboard";
import { linuxKeyboardPort } from "./host-keyboard-linux";
import { sharedLighting } from "./qmk-lighting";
import { viaPermissionBroker } from "./via-permissions";

const setup = Effect.gen(function* () {
	const fake = yield* makeFakeHardwareTransport({ serial: "A" });
	const device = yield* QuakeDevice.pipe(
		Effect.provide(
			QuakeDevice.DefaultWithoutDependencies.pipe(Layer.provide(fake.layer)),
		),
	);
	const connection = yield* device.connect();
	const controls = yield* HardwareControls.pipe(
		Effect.provide(HardwareControls.Default),
	);
	const session = yield* controls.create(connection, {
		serial: "A",
		session: "a1",
	});
	yield* session.refresh();
	return { fake, session };
});
it.scoped(
	"saved buzzer/mic/game mode keys execute real registry configs with serial guards",
	() =>
		Effect.gen(function* () {
			const { session, fake } = yield* setup;
			for (const type of ["buzzer", "mic", "gameMode"] as const) {
				const config = Schema.decodeUnknownSync(HardwareKeyConfig)(
					createActionDraft(type),
				);
				yield* executeHardwareKey(config, session, "A");
			}
			expect(yield* session.snapshot()).toMatchObject({
				mic: false,
				inputMode: "host",
				preferences: { buzzerEnabled: false },
			});
			const count = (yield* fake.writes).length;
			const wrong = yield* executeHardwareKey(
				Schema.decodeUnknownSync(HardwareKeyConfig)(createActionDraft("mic")),
				session,
				"B",
			).pipe(Effect.either);
			expect(wrong._tag).toBe("Left");
			expect(yield* fake.writes).toHaveLength(count);
		}),
);
it.scoped(
	"QMK lighting reads/applies/saves through the existing one handle, then hardware delivery resumes",
	() =>
		Effect.gen(function* () {
			const { session, fake } = yield* setup;
			yield* Effect.gen(function* () {
				const lighting = yield* LightingService;
				const target = { serial: "A", session: "a1" };
				const selected = yield* lighting.select(target);
				expect(selected.applied).toContainEqual({
					field: "brightness",
					value: 128,
				});
				yield* lighting.setDesired(target, { field: "brightness", value: 200 });
				expect((yield* lighting.flush(target)).applied).toContainEqual({
					field: "brightness",
					value: 200,
				});
				expect((yield* lighting.save(target)).saveStatus).toBe("saved");
				expect(
					(yield* lighting
						.select({ serial: "B", session: "a1" })
						.pipe(Effect.either))._tag,
				).toBe("Left");
				yield* session.toggleMic();
				expect((yield* session.snapshot()).mic).toBe(false);
				expect(yield* fake.opens).toBe(1);
			}).pipe(Effect.provide(sharedLighting(() => [session])));
		}),
);
it.scoped(
	"Linux uinput host chords release in reverse order on cancellation and reject permissions",
	() =>
		Effect.gen(function* () {
			const ioctls: number[] = [],
				writes: Buffer[] = [],
				closed: number[] = [];
			const linux = linuxKeyboardPort({
				open: () => 10,
				ioctl: (_fd, op) => {
					ioctls.push(op);
				},
				write: (_fd, bytes) => {
					writes.push(bytes);
				},
				close: (fd) => {
					closed.push(fd);
				},
			});
			const keyboard = hostKeyboardAdapter({
				...linux,
				code: (usage) => usage,
			});
			const pressing = yield* keyboard
				.pressChord("control+a")
				.pipe(Effect.fork);
			yield* TestClock.adjust(10);
			yield* Fiber.interrupt(pressing);
			expect(
				writes.map((b) => [b.readUInt16LE(18), b.readInt32LE(20)]),
			).toEqual([
				[29, 1],
				[30, 1],
				[30, 0],
				[29, 0],
			]);
			expect(
				writes.every((b) => b.length === 48 && b.readUInt16LE(40) === 0),
			).toBe(true);
			linux.close();
			expect(ioctls).toContain(0x5501);
			expect(ioctls.at(-1)).toBe(0x5502);
			expect(closed).toEqual([10]);
			const denied = hostKeyboardAdapter({
				available: () => false,
				post: () => {
					throw new Error("must not post");
				},
			});
			const result = yield* denied.pressChord("a").pipe(Effect.either);
			expect(result._tag === "Left" && result.left.code).toBe(
				"QUAKE.ACTION.HOST_FAILED",
			);
		}),
);
it("VIA selects only exact origin/serial/collection and awaits exclusive release", async () => {
	const d = {
		deviceId: "raw",
		serialNumber: "A",
		vendorId: 0x4158,
		productId: 0x514b,
		collections: [{ usagePage: 0xff60, usage: 0x61 }],
	};
	let release = 0,
		resumed = 0;
	const broker = viaPermissionBroker({
		origin: "http://localhost:3010",
		selectedSerial: () => "A",
		release: async () => {
			release++;
			return async () => {
				resumed++;
			};
		},
	});
	for (const device of [
		{ ...d, vendorId: 0x5012 },
		{ ...d, serialNumber: "B" },
		{ ...d, collections: [{ usagePage: 1, usage: 6 }] },
	])
		expect(await broker.select("http://localhost:3010", [device])).toBe("");
	expect(await broker.select("https://foreign.test", [d])).toBe("");
	expect(release).toBe(0);
	expect(await broker.select("http://localhost:3010", [d])).toBe("raw");
	expect(broker.permitted("http://localhost:3010", d)).toBe(true);
	expect(await broker.select("http://localhost:3010", [d])).toBe("");
	await broker.resume();
	expect(resumed).toBe(1);
	expect(broker.permitted("http://localhost:3010", d)).toBe(false);
});

it.scoped(
	"MAIN-108 bounded probes restore values, cache menu bindings per session and reject stale batches",
	() =>
		Effect.gen(function* () {
			const { session, fake } = yield* setup;
			const { qmkRequest } = yield* Effect.promise(
				() => import("./qmk-controller"),
			);
			const probe = yield* qmkRequest(
				{
					_tag: "qmk",
					serial: "A",
					session: "a1",
					operations: [
						{ _tag: "probe", name: "brightness", prefix: [9], values: [201] },
					],
				},
				[session],
			);
			expect(probe).toEqual({ _tag: "qmk", values: [[128, 201, 1]] });
			expect(
				yield* session.qmk([{ _tag: "get", prefix: [9], length: 1 }]),
			).toEqual([[128]]);
			expect(
				yield* qmkRequest({ _tag: "qmkBindings", serial: "A", session: "a1" }, [
					session,
				]),
			).toEqual({
				_tag: "qmkBindings",
				bindings: [
					{
						name: "brightness",
						prefix: [9],
						before: [128],
						after: [201],
						changed: true,
					},
				],
			});
			const before = (yield* fake.writes).length;
			expect(
				yield* qmkRequest(
					{
						_tag: "qmk",
						serial: "A",
						session: "replaced",
						operations: [{ _tag: "save" }],
					},
					[session],
				),
			).toMatchObject({ _tag: "failure" });
			expect(yield* fake.writes).toHaveLength(before);
			yield* Effect.all(
				[
					session.qmk([
						{ _tag: "set", prefix: [9], values: [70] },
						{ _tag: "set", prefix: [11], values: [30] },
						{ _tag: "save" },
					]),
					session.toggleMic(),
				],
				{ concurrency: 2 },
			);
			const writes = (yield* fake.writes).slice(before);
			const start = writes.findIndex((bytes) => bytes[1] === 7);
			expect(writes.slice(start, start + 3).map((bytes) => bytes[1])).toEqual([
				7, 7, 9,
			]);
			expect(yield* fake.opens).toBe(1);
		}),
);

it.scoped(
	"MAIN-108 v3 menu channels probe and restore through the shared raw owner",
	() =>
		Effect.gen(function* () {
			const fake = yield* makeFakeHardwareTransport({
				serial: "A",
				qmkProtocolVersion: 12,
				qmkValues: [{ prefix: [1, 9], values: [90] }],
			});
			const device = yield* QuakeDevice.pipe(
				Effect.provide(
					QuakeDevice.DefaultWithoutDependencies.pipe(
						Layer.provide(fake.layer),
					),
				),
			);
			const controls = yield* HardwareControls.pipe(
				Effect.provide(HardwareControls.Default),
			);
			const session = yield* controls.create(yield* device.connect(), {
				serial: "A",
				session: "v3",
			});
			expect(
				yield* session.qmk([
					{ _tag: "protocol" },
					{
						_tag: "probe",
						name: "custom brightness",
						prefix: [1, 9],
						values: [180],
					},
					{ _tag: "get", prefix: [1, 9], length: 1 },
					{ _tag: "save", channel: 1 },
				]),
			).toEqual([[0, 12], [90, 180, 1], [90], []]);
			expect(yield* fake.opens).toBe(1);
		}),
);
it.scoped(
	"SETTINGS-024 protocol alone cannot qualify lighting for an unknown firmware",
	() =>
		Effect.gen(function* () {
			const fake = yield* makeFakeHardwareTransport({ serial: "A" });
			const device = yield* QuakeDevice.pipe(
				Effect.provide(
					QuakeDevice.DefaultWithoutDependencies.pipe(
						Layer.provide(fake.layer),
					),
				),
			);
			const controls = yield* HardwareControls.pipe(
				Effect.provide(HardwareControls.Default),
			);
			const session = yield* controls.create(yield* device.connect(), {
				serial: "A",
				session: "unknown",
			});
			yield* Effect.gen(function* () {
				const lighting = yield* LightingService;
				const result = yield* lighting.select({
					serial: "A",
					session: "unknown",
				});
				expect(result.status).toBe("unavailable");
				expect(result.capabilities.fields).toEqual([]);
			}).pipe(Effect.provide(sharedLighting(() => [session])));
		}),
);
