import { expect, it } from "@effect/vitest";
import { Clock, Effect, Either, Fiber, Layer, Option, TestClock } from "effect";
import { QuakeDevice } from "../../src/device-service.js";
import {
	defaultHardwarePreferences,
	type HardwarePreferences,
} from "../../src/hardware/hardware-contracts.js";
import {
	fakeHardwareReply,
	makeFakeHardwareTransport,
} from "../../src/hardware/hardware-fake.js";
import { buzzerTones } from "../../src/hardware/hardware-invariants.js";
import { HardwarePreferencesStore } from "../../src/hardware/hardware-repository.js";
import { HardwareControls } from "../../src/hardware/hardware-service.js";

const setup = (options: Parameters<typeof makeFakeHardwareTransport>[0] = {}) =>
	Effect.gen(function* () {
		const saved = new Map<string, HardwarePreferences>();
		const controls = yield* HardwareControls.pipe(
			Effect.provide(
				HardwareControls.DefaultWithoutDependencies.pipe(
					Layer.provide(
						Layer.succeed(HardwarePreferencesStore, {
							read: (serial) =>
								Effect.sync(() => Option.fromNullable(saved.get(serial))),
							write: (serial, value) =>
								Effect.sync(() => {
									saved.set(serial, value);
								}),
						}),
					),
				),
			),
		);
		let sequence = 0;
		const connect = (serial: string) =>
			Effect.gen(function* () {
				const fake = yield* makeFakeHardwareTransport({ ...options, serial });
				const device = yield* QuakeDevice.pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
				const connection = yield* device.connect();
				const session = yield* controls.create(connection, {
					serial,
					session: `session-${serial}-${sequence++}`,
				});
				return { fake, session, connection };
			});
		return { connect, saved };
	});

it.scoped(
	"MAIN-013 SETTINGS-080/081 restores acknowledged cache without claiming live synchronization",
	() =>
		Effect.gen(function* () {
			const { connect, saved } = yield* setup();
			yield* Effect.scoped(
				Effect.gen(function* () {
					const { session } = yield* connect("ABCD");
					expect(yield* session.snapshot()).toMatchObject({
						recovered: { mic: true, luminance: 255 },
						stateSyncSuccess: false,
					});
					expect((yield* session.snapshot()).mic).toBeUndefined();
					yield* session.refresh();
					yield* session.toggleMic();
					yield* session.stepBrightness(-1);
					yield* TestClock.adjust(500);
					expect(saved.get("ABCD")).toMatchObject({
						mic: false,
						luminance: 229,
					});
				}),
			);
			const { session } = yield* connect("ABCD");
			expect(yield* session.snapshot()).toMatchObject({
				recovered: { mic: false, luminance: 229 },
				pendingStateSync: false,
				stateSyncSuccess: false,
			});
			expect((yield* session.snapshot()).mic).toBeUndefined();
			const other = yield* connect("OTHER");
			expect(yield* other.session.snapshot()).toMatchObject({
				recovered: { mic: true, luminance: 255 },
			});
			yield* session.refresh();
			expect(yield* session.snapshot()).toMatchObject({
				stateSyncSuccess: true,
				mic: true,
				luminance: 255,
			});
		}),
);

it.scoped(
	"MAIN-013 rejected mic and luminance writes never enter the persisted cache",
	() =>
		Effect.gen(function* () {
			let reject = false;
			const { connect, saved } = yield* setup({
				onCommand: (c) =>
					c.opCode === 2
						? [
								fakeHardwareReply(
									c.cmdId,
									c.cmdId === 46 ? [1, 1, 0, 21] : [c.cmdId === 3 ? 1 : 255],
								),
							]
						: [fakeHardwareReply(0, [reject ? 0 : 0x90])],
			});
			const { session } = yield* connect("A");
			yield* session.refresh();
			yield* TestClock.adjust(500);
			reject = true;
			expect(
				Either.isLeft(yield* session.toggleMic().pipe(Effect.either)),
			).toBe(true);
			expect(
				Either.isLeft(yield* session.stepBrightness(-1).pipe(Effect.either)),
			).toBe(true);
			yield* TestClock.adjust(500);
			expect(saved.get("A")).toMatchObject({ mic: true, luminance: 255 });
			expect(yield* session.snapshot()).toMatchObject({
				mic: true,
				luminance: 255,
			});
		}),
);

it.scoped(
	"MAIN-013 missing live reply leaves synchronization unsuccessful and recovered values intact",
	() =>
		Effect.gen(function* () {
			const { connect, saved } = yield* setup({
				onCommand: (c) =>
					c.cmdId === 46 ? [fakeHardwareReply(46, [1, 1, 0, 21])] : [],
			});
			saved.set("A", {
				...defaultHardwarePreferences,
				mic: false,
				luminance: 77,
			});
			const { session } = yield* connect("A");
			const pending = yield* session.refresh().pipe(Effect.either, Effect.fork);
			yield* TestClock.adjust(0);
			expect(yield* session.snapshot()).toMatchObject({
				pendingStateSync: true,
				stateSyncSuccess: false,
			});
			yield* TestClock.adjust(3000);
			expect(Either.isLeft(yield* Fiber.join(pending))).toBe(true);
			expect(yield* session.snapshot()).toMatchObject({
				pendingStateSync: false,
				stateSyncSuccess: false,
				recovered: { mic: false, luminance: 77 },
			});
			expect(saved.get("A")).toMatchObject({ mic: false, luminance: 77 });
		}),
);

for (const name of [
	"start",
	"end",
	"error",
	"busy",
	"preview",
	"firework",
	"success",
] as const) {
	it.scoped(
		`AI-076 MAIN-021/022 MGMT-408 exact ${name} tone and trailing silence`,
		() =>
			Effect.gen(function* () {
				const levels: { level: number; at: number }[] = [];
				const { connect } = yield* setup();
				const { session, fake } = yield* connect("A");
				const observer = yield* fake.writes.pipe(Effect.map(() => undefined));
				void observer;
				const start = yield* Clock.currentTimeMillis;
				const playing = yield* session.playTone(name).pipe(Effect.fork);
				yield* TestClock.adjust(0);
				for (const [level, ms] of buzzerTones[name]) {
					const writes = yield* fake.writes;
					const command = writes.at(-1);
					expect(command?.[5]).toBe(level === 0 ? 0 : 84);
					levels.push({
						level: command?.[5] ?? -1,
						at: (yield* Clock.currentTimeMillis) - start,
					});
					yield* TestClock.adjust(ms);
					expect((yield* fake.writes).at(-1)?.[5]).toBe(0);
					yield* TestClock.adjust(10);
				}
				yield* Fiber.join(playing);
				expect(levels.map((x) => x.level)).toEqual(
					buzzerTones[name].map(([v]) => (v === 0 ? 0 : 84)),
				);
			}),
	);
}

it.scoped(
	"MAIN-021 bounded arbitrary sequences reject before writes and silence on interruption",
	() =>
		Effect.gen(function* () {
			const { connect } = yield* setup();
			const { session, fake } = yield* connect("A");
			for (const invalid of [
				[],
				[[1, 20]],
				[[80, -1]],
				[[80, 60001]],
				Array.from({ length: 65 }, () => [80, 1]),
				[
					[80, 60000],
					[80, 60000],
					[80, 1],
				],
			])
				expect(
					Either.isLeft(
						yield* session.playSequence(invalid).pipe(Effect.either),
					),
				).toBe(true);
			expect(yield* fake.writes).toHaveLength(0);
			const playing = yield* session
				.playSequence([
					[80, 1000],
					[90, 100],
				])
				.pipe(Effect.fork);
			yield* TestClock.adjust(20);
			yield* Fiber.interrupt(playing);
			expect((yield* fake.writes).at(-1)?.[5]).toBe(0);
		}),
);

it.scoped(
	"SETTINGS-082 long tone stops on disable, explicit stop and teardown; disabled and zero volume suppress tones",
	() =>
		Effect.gen(function* () {
			const { connect } = yield* setup();
			const { session, fake } = yield* connect("A");
			yield* session.setLongTone(true);
			expect((yield* fake.writes).at(-1)?.[5]).toBe(84);
			yield* session.setLongTone(false);
			expect((yield* fake.writes).at(-1)?.[5]).toBe(0);
			yield* session.setLongTone(true);
			yield* session.configure({
				...defaultHardwarePreferences,
				buzzerEnabled: false,
			});
			expect((yield* fake.writes).at(-1)?.[5]).toBe(0);
			const count = (yield* fake.writes).length;
			yield* session.playTone("success");
			yield* session.setLongTone(true);
			expect(yield* fake.writes).toHaveLength(count);
			yield* session.configure({
				...defaultHardwarePreferences,
				alertVolume: 0,
			});
			yield* session.playTone("firework");
			yield* session.setLongTone(true);
			expect(yield* fake.writes).toHaveLength(count);
			let finalFake: typeof fake | undefined;
			yield* Effect.scoped(
				Effect.gen(function* () {
					const other = yield* connect("B");
					finalFake = other.fake;
					yield* other.session.setLongTone(true);
				}),
			);
			expect(finalFake && (yield* finalFake.writes).at(-1)?.[5]).toBe(0);
		}),
);

it.scoped(
	"MAIN-013 replacement invalidates old writes and old pending saves",
	() =>
		Effect.gen(function* () {
			const { connect, saved } = yield* setup();
			const old = yield* connect("A");
			yield* old.session.configure({
				...defaultHardwarePreferences,
				buzzerEnabled: false,
			});
			const replacement = yield* connect("A");
			expect((yield* old.session.snapshot()).available).toBe(false);
			expect(
				Either.isLeft(
					yield* old.session
						.configure(defaultHardwarePreferences)
						.pipe(Effect.either),
				),
			).toBe(true);
			yield* replacement.session.configure({
				...defaultHardwarePreferences,
				knobLedAlwaysOn: false,
			});
			yield* TestClock.adjust(500);
			expect(saved.get("A")).toMatchObject({
				buzzerEnabled: true,
				knobLedAlwaysOn: false,
			});
		}),
);
