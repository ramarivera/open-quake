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
	"MAIN-013 replacement flushes old pending preferences before invalidating old writes",
	() =>
		Effect.gen(function* () {
			const { connect, saved } = yield* setup();
			const old = yield* connect("A");
			yield* old.session.configure({
				...defaultHardwarePreferences,
				buzzerEnabled: false,
			});
			const replacement = yield* connect("A");
			expect(
				(yield* replacement.session.snapshot()).preferences.buzzerEnabled,
			).toBe(false);
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

it.scoped(
	"MAIN-108 missing raw replies close and poison the owner before another transaction",
	() =>
		Effect.gen(function* () {
			const { makeFakeHidTransport } = yield* Effect.promise(
				() => import("../../src/hid-fake.js"),
			);
			const fake = yield* makeFakeHidTransport();
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
			const session = yield* controls.create(connection, {
				serial: "fake-quake",
				session: "timeout",
			});
			const pending = yield* session
				.qmk([{ _tag: "protocol" }])
				.pipe(Effect.either, Effect.fork);
			yield* TestClock.adjust(1500);
			expect(Either.isLeft(yield* Fiber.join(pending))).toBe(true);
			expect((yield* session.snapshot()).available).toBe(false);
			const writes = (yield* fake.writes).length;
			expect(
				Either.isLeft(
					yield* session.qmk([{ _tag: "save" }]).pipe(Effect.either),
				),
			).toBe(true);
			expect(yield* fake.writes).toHaveLength(writes);
		}),
);

it.scoped(
	"queued long-tone startup settles when released before acquiring toneLock",
	() =>
		Effect.gen(function* () {
			const { connect } = yield* setup();
			const { session, fake } = yield* connect("tone-start");
			const sequence = yield* session
				.playSequence([[80, 60000]])
				.pipe(Effect.fork);
			yield* TestClock.adjust(0);
			const starting = yield* session
				.setLongTone(true)
				.pipe(Effect.either, Effect.fork);
			yield* TestClock.adjust(0);
			expect(Option.isNone(yield* Fiber.poll(starting))).toBe(true);
			yield* session.setLongTone(false);
			expect(Option.isSome(yield* Fiber.poll(starting))).toBe(true);
			const result = yield* Fiber.join(starting);
			expect(result._tag === "Left" && result.left.code).toBe(
				"QUAKE.HARDWARE.UNAVAILABLE",
			);
			yield* Fiber.interrupt(sequence);
			expect((yield* fake.writes).at(-1)?.[5]).toBe(0);
		}),
);
for (const silent of ["disabled", "zero"] as const) {
	it.scoped(
		`master ${silent} stops an active 60-second sequence before configure settles`,
		() =>
			Effect.gen(function* () {
				const { connect } = yield* setup();
				const { session, fake } = yield* connect(silent);
				const sequence = yield* session
					.playSequence([[80, 60000]])
					.pipe(Effect.fork);
				yield* TestClock.adjust(1);
				expect((yield* fake.writes).at(-1)?.[5]).toBe(84);
				yield* session.configure({
					...defaultHardwarePreferences,
					...(silent === "disabled"
						? { buzzerEnabled: false }
						: { alertVolume: 0 }),
				});
				expect((yield* fake.writes).at(-1)?.[5]).toBe(0);
				expect(Option.isSome(yield* Fiber.poll(sequence))).toBe(true);
				yield* Fiber.join(sequence);
			}),
	);
}
it.scoped(
	"reconnect within debounce preserves acknowledged mic, brightness and disabled buzzer",
	() =>
		Effect.gen(function* () {
			const { connect, saved } = yield* setup();
			const old = yield* connect("reconnect");
			yield* old.session.refresh();
			yield* old.session.toggleMic();
			yield* old.session.stepBrightness(-1);
			yield* old.session.configure({
				...defaultHardwarePreferences,
				buzzerEnabled: false,
			});
			expect(saved.has("reconnect")).toBe(false);
			const replacement = yield* connect("reconnect");
			expect((yield* replacement.session.snapshot()).preferences).toMatchObject(
				{ buzzerEnabled: false, mic: false, luminance: 229 },
			);
			expect(saved.get("reconnect")).toMatchObject({
				buzzerEnabled: false,
				mic: false,
				luminance: 229,
			});
			yield* TestClock.adjust(500);
			expect(saved.get("reconnect")?.buzzerEnabled).toBe(false);
		}),
);
for (const lost of ["write", "read", "restore"] as const) {
	it.scoped(
		`reversible probe missing ${lost} reply releases locks and closes the native owner`,
		() =>
			Effect.gen(function* () {
				const { makeFakeHidTransport } = yield* Effect.promise(
					() => import("../../src/hid-fake.js"),
				);
				const { HidTransport } = yield* Effect.promise(
					() => import("../../src/hid-transport.js"),
				);
				const fake = yield* makeFakeHidTransport();
				let raw = 0;
				const replies = [
					1,
					...(lost === "write" ? [] : [2]),
					...(lost === "restore" ? [3] : []),
				];
				const transport = {
					...fake.transport,
					open: (info: Parameters<typeof fake.transport.open>[0]) =>
						fake.transport.open(info).pipe(
							Effect.map((handle) => ({
								...handle,
								write: (report: Uint8Array) =>
									handle.write(report).pipe(
										Effect.zipRight(
											Effect.suspend(() => {
												if (report[1] !== 7 && report[1] !== 8)
													return Effect.void;
												raw++;
												return replies.includes(raw)
													? fake.emit(report.slice(1))
													: Effect.void;
											}),
										),
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
					serial: "probe",
					session: "s",
				});
				const probing = yield* session
					.qmk([
						{ _tag: "probe", name: "brightness", prefix: [9], values: [180] },
					])
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(1500);
				expect(Option.isSome(yield* Fiber.poll(probing))).toBe(true);
				expect((yield* Fiber.join(probing))._tag).toBe("Left");
				yield* connection.disconnect();
				expect(yield* fake.closes).toBe(1);
				expect((yield* session.snapshot()).available).toBe(false);
			}),
	);
}

it.scoped(
	"replacement waits for a started acknowledged mic mutation before flushing and transferring ownership",
	() =>
		Effect.gen(function* () {
			let held = false;
			const { connect, saved } = yield* setup({
				onCommand: (c) =>
					c.opCode === 2
						? [
								fakeHardwareReply(
									c.cmdId,
									c.cmdId === 46 ? [1, 1, 0, 21] : [c.cmdId === 3 ? 1 : 255],
								),
							]
						: held
							? []
							: [fakeHardwareReply(0, [0x90])],
			});
			const old = yield* connect("racing-reconnect");
			yield* old.session.refresh();
			held = true;
			const changing = yield* old.session.toggleMic().pipe(Effect.fork);
			yield* TestClock.adjust(0);
			const replacing = yield* connect("racing-reconnect").pipe(Effect.fork);
			yield* TestClock.adjust(0);
			expect(Option.isNone(yield* Fiber.poll(replacing))).toBe(true);
			yield* old.fake.emit(fakeHardwareReply(0, [0x90]));
			yield* Fiber.join(changing);
			const replacement = yield* Fiber.join(replacing);
			expect((yield* replacement.session.snapshot()).recovered?.mic).toBe(
				false,
			);
			expect(saved.get("racing-reconnect")?.mic).toBe(false);
		}),
);

for (const order of ["start-stop", "stop-start"] as const) {
	it.scoped(
		`overlapping long-tone ${order} retains the final worker owner`,
		() =>
			Effect.gen(function* () {
				let holdSilence = true;
				const { connect } = yield* setup({
					onCommand: (c) => {
						if (
							c.opCode === 1 &&
							c.cmdId === 2 &&
							c.subData[0] === 0 &&
							holdSilence
						) {
							holdSilence = false;
							return [];
						}
						return c.opCode === 2
							? [fakeHardwareReply(c.cmdId, [1, 1, 0, 21])]
							: [fakeHardwareReply(0, [0x90])];
					},
				});
				const { session, fake } = yield* connect(order);
				yield* session.setLongTone(true);
				const first = yield* session
					.setLongTone(order === "start-stop")
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(0);
				expect(holdSilence).toBe(false);
				const second = yield* session
					.setLongTone(order === "stop-start")
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(0);
				expect(Option.isNone(yield* Fiber.poll(first))).toBe(true);
				expect(Option.isNone(yield* Fiber.poll(second))).toBe(true);
				yield* fake.emit(fakeHardwareReply(0, [0x90]));
				yield* TestClock.adjust(0);
				yield* Fiber.join(first);
				yield* Fiber.join(second);
				expect((yield* fake.writes).at(-1)?.[5]).toBe(
					order === "start-stop" ? 0 : 84,
				);
				// A subsequent release must still own the final tone, even after overlap.
				yield* session.setLongTone(false);
				expect((yield* fake.writes).at(-1)?.[5]).toBe(0);
			}),
	);
}

for (const preference of ["disabled", "zero"] as const) {
	it.scoped(
		`master ${preference} owns a concurrent long-tone replacement`,
		() =>
			Effect.gen(function* () {
				let holdSilence = true;
				const { connect } = yield* setup({
					onCommand: (c) => {
						if (
							c.opCode === 1 &&
							c.cmdId === 2 &&
							c.subData[0] === 0 &&
							holdSilence
						) {
							holdSilence = false;
							return [];
						}
						return c.opCode === 2
							? [fakeHardwareReply(c.cmdId, [1, 1, 0, 21])]
							: [fakeHardwareReply(0, [0x90])];
					},
				});
				const { session, fake } = yield* connect(`overlap-${preference}`);
				yield* session.setLongTone(true);
				const replacing = yield* session
					.setLongTone(true)
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(0);
				expect(holdSilence).toBe(false);
				const disabling = yield* session
					.configure({
						...defaultHardwarePreferences,
						...(preference === "disabled"
							? { buzzerEnabled: false }
							: { alertVolume: 0 }),
					})
					.pipe(Effect.fork);
				yield* TestClock.adjust(0);
				expect(Option.isNone(yield* Fiber.poll(disabling))).toBe(true);
				yield* fake.emit(fakeHardwareReply(0, [0x90]));
				yield* Fiber.join(replacing);
				yield* Fiber.join(disabling);
				yield* TestClock.adjust(1000);
				const levels = (yield* fake.writes)
					.filter((r) => r[3] === 1 && r[4] === 2)
					.map((r) => r[5]);
				expect(levels).toEqual([84, 0]);
			}),
	);
}

it.scoped(
	"cancelled queued long-tone startup never sounds after a sequence releases",
	() =>
		Effect.gen(function* () {
			const { connect } = yield* setup();
			const { session, fake } = yield* connect("cancelled-tone-start");
			const sequence = yield* session
				.playSequence([[80, 60000]])
				.pipe(Effect.fork);
			yield* TestClock.adjust(0);
			const starting = yield* session.setLongTone(true).pipe(Effect.fork);
			yield* TestClock.adjust(0);
			expect(Option.isNone(yield* Fiber.poll(starting))).toBe(true);
			yield* Fiber.interrupt(starting);
			yield* Fiber.interrupt(sequence);
			yield* TestClock.adjust(0);
			const levels = (yield* fake.writes)
				.filter((r) => r[3] === 1 && r[4] === 2)
				.map((r) => r[5]);
			expect(levels).toEqual([84, 0]);
		}),
);

for (const replace of [false, true]) {
	it.scoped(
		`interrupted long-tone startup drains its write and preserves replacement=${replace}`,
		() =>
			Effect.gen(function* () {
				let holdStartup = true;
				const { connect } = yield* setup({
					onCommand: (c) => {
						if (
							c.opCode === 1 &&
							c.cmdId === 2 &&
							c.subData[0] !== 0 &&
							holdStartup
						) {
							holdStartup = false;
							return [];
						}
						return c.opCode === 2
							? [fakeHardwareReply(c.cmdId, [1, 1, 0, 21])]
							: [fakeHardwareReply(0, [0x90])];
					},
				});
				const { session, fake } = yield* connect(`cancelled-start-${replace}`);
				const starting = yield* session
					.setLongTone(true)
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(0);
				expect(holdStartup).toBe(false);
				const replacement = replace
					? yield* session.setLongTone(true).pipe(Effect.fork)
					: undefined;
				yield* TestClock.adjust(0);
				const cancelling = yield* Fiber.interrupt(starting).pipe(Effect.fork);
				yield* TestClock.adjust(0);
				yield* fake.emit(fakeHardwareReply(0, [0x90]));
				yield* TestClock.adjust(0);
				yield* Fiber.join(cancelling);
				if (replacement) yield* Fiber.join(replacement);
				const levels = (yield* fake.writes)
					.filter((r) => r[3] === 1 && r[4] === 2)
					.map((r) => r[5]);
				expect(levels).toEqual(replace ? [84, 0, 84] : [84, 0]);
				yield* session.setLongTone(false);
				expect((yield* fake.writes).at(-1)?.[5]).toBe(0);
			}),
	);
}
