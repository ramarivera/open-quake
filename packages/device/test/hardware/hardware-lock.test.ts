import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Exit, Fiber, Layer, Scope, TestClock } from "effect";
import { QuakeDevice } from "../../src/device-service.js";
import {
	fakeHardwareReply,
	makeFakeHardwareTransport,
} from "../../src/hardware/hardware-fake.js";
import {
	defaultHardwarePreferences,
	HardwareControls,
} from "../../src/hardware/index.js";

const setup = (options?: Parameters<typeof makeFakeHardwareTransport>[0]) =>
	Effect.gen(function* () {
		const fake = yield* makeFakeHardwareTransport(options);
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
			serial: "lock",
			session: "lock-1",
		});
		yield* session.configure({
			...defaultHardwarePreferences,
			knobLedAlwaysOn: false,
		});
		return { fake, session, connection, controls };
	});
const commands = (writes: readonly Uint8Array[]) =>
	writes.map((bytes) => [...bytes.slice(3, 3 + (bytes[2] ?? 0))]);

describe("pre-lock knob lighting state", () => {
	for (const phase of ["query", "disable"] as const) {
		for (const scoped of [false, true]) {
			it.scoped(
				`finishes a pending ${phase} exchange when its session scope closes, scoped caller ${scoped}`,
				() =>
					Effect.gen(function* () {
						const { fake, controls, connection } = yield* setup({
							onCommand: (command) =>
								phase === "disable" && command.opCode === 2
									? [fakeHardwareReply(6, [1])]
									: [],
						});
						const sessionScope = yield* Scope.make();
						const session = yield* controls
							.create(connection, { serial: "closing", session: phase })
							.pipe(Scope.extend(sessionScope));
						yield* session.configure({
							...defaultHardwarePreferences,
							knobLedAlwaysOn: false,
						});
						const locking = yield* session
							.setLocked(true)
							.pipe(
								Effect.either,
								scoped ? Effect.forkIn(sessionScope) : Effect.fork,
							);
						yield* TestClock.adjust(0);
						yield* Scope.close(sessionScope, Exit.void);
						const result = yield* Fiber.join(locking);
						expect(Either.isLeft(result) && result.left.code).toBe(
							"QUAKE.HARDWARE.UNAVAILABLE",
						);
						yield* session.setLocked(false).pipe(Effect.either);
						expect(
							commands(
								(yield* fake.writes).filter((bytes) => bytes[4] !== 0xef),
							),
						).toEqual(
							phase === "query"
								? [[2, 6]]
								: [
										[2, 6],
										[1, 6, 0],
									],
						);
					}),
			);
		}
	}
	it.scoped("leaves a ring that was already off untouched through unlock", () =>
		Effect.gen(function* () {
			const { fake, session } = yield* setup();
			yield* session.send({ _tag: "KnobLed", on: false });
			yield* session.setLocked(true);
			yield* session.setLocked(false);
			expect(
				commands((yield* fake.writes).filter((bytes) => bytes[4] !== 0xef)),
			).toEqual([
				[1, 6, 0],
				[2, 6],
			]);
		}),
	);
	it.scoped(
		"reads once and restores once across duplicate concurrent events",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup();
				yield* Effect.all([session.setLocked(true), session.setLocked(true)], {
					concurrency: "unbounded",
				});
				yield* Effect.all(
					[session.setLocked(false), session.setLocked(false)],
					{ concurrency: "unbounded" },
				);
				expect(
					commands((yield* fake.writes).filter((bytes) => bytes[4] !== 0xef)),
				).toEqual([
					[2, 6],
					[1, 6, 0],
					[1, 6, 1],
				]);
			}),
	);
	it.scoped(
		"ignores an unlock with no recorded lock and reads anew next cycle",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup();
				yield* session.setLocked(false);
				expect(
					(yield* fake.writes).filter((bytes) => bytes[4] !== 0xef),
				).toHaveLength(0);
				yield* session.setLocked(true);
				yield* session.setLocked(false);
				yield* session.send({ _tag: "KnobLed", on: false });
				yield* session.setLocked(true);
				yield* session.setLocked(false);
				expect(
					commands((yield* fake.writes).filter((bytes) => bytes[4] !== 0xef)),
				).toEqual([
					[2, 6],
					[1, 6, 0],
					[1, 6, 1],
					[1, 6, 0],
					[2, 6],
				]);
			}),
	);
	it.scoped(
		"restores an acknowledged disable even if always-on changes while locked",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup();
				yield* session.setLocked(true);
				yield* session.configure(defaultHardwarePreferences);
				yield* session.setLocked(false);
				yield* session.setLocked(true);
				yield* session.setLocked(false);
				expect(
					commands((yield* fake.writes).filter((bytes) => bytes[4] !== 0xef)),
				).toEqual([
					[2, 6],
					[1, 6, 0],
					[1, 6, 1],
				]);
			}),
	);
	it.scoped("does not start managing a lock bypassed by always-on", () =>
		Effect.gen(function* () {
			const { fake, session } = yield* setup();
			yield* session.configure(defaultHardwarePreferences);
			yield* session.setLocked(true);
			yield* session.configure({
				...defaultHardwarePreferences,
				knobLedAlwaysOn: false,
			});
			yield* session.setLocked(true);
			yield* session.setLocked(false);
			expect(
				(yield* fake.writes).filter((bytes) => bytes[4] !== 0xef),
			).toHaveLength(0);
		}),
	);
	it.scoped("a failed state query cannot turn lighting on during unlock", () =>
		Effect.gen(function* () {
			const { fake, session } = yield* setup({ onCommand: () => [] });
			const lock = yield* session
				.setLocked(true)
				.pipe(Effect.either, Effect.fork);
			yield* TestClock.adjust(3000);
			const failed = yield* Fiber.join(lock);
			expect(Either.isLeft(failed) && failed.left.code).toBe(
				"QUAKE.HARDWARE.REPLY_TIMEOUT",
			);
			yield* session.setLocked(false).pipe(Effect.either);
			expect(
				commands((yield* fake.writes).filter((bytes) => bytes[4] !== 0xef)),
			).toEqual([[2, 6]]);
		}),
	);
	it.scoped("a rejected disable does not schedule an enable", () =>
		Effect.gen(function* () {
			const { fake, session } = yield* setup({
				onCommand: (command) => [
					command.opCode === 2
						? fakeHardwareReply(6, [1])
						: fakeHardwareReply(0, [1]),
				],
			});
			const failed = yield* session.setLocked(true).pipe(Effect.either);
			expect(Either.isLeft(failed) && failed.left.code).toBe(
				"QUAKE.HARDWARE.COMMAND_REJECTED",
			);
			yield* session.setLocked(false);
			expect(
				commands((yield* fake.writes).filter((bytes) => bytes[4] !== 0xef)),
			).toEqual([
				[2, 6],
				[1, 6, 0],
			]);
		}),
	);
	it.scoped(
		"finishes an acknowledged transition before honoring cancellation",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup({
					onCommand: (command) =>
						command.opCode === 2 ? [fakeHardwareReply(6, [1])] : [],
				});
				const locking = yield* session.setLocked(true).pipe(Effect.fork);
				yield* TestClock.adjust(0);
				const cancellation = yield* Fiber.interrupt(locking).pipe(Effect.fork);
				yield* fake.emit(fakeHardwareReply(0, [0x90]));
				yield* Fiber.join(cancellation);
				const unlocking = yield* session.setLocked(false).pipe(Effect.fork);
				yield* TestClock.adjust(0);
				yield* fake.emit(fakeHardwareReply(0, [0x90]));
				yield* Fiber.join(unlocking);
				expect(
					commands((yield* fake.writes).filter((bytes) => bytes[4] !== 0xef)),
				).toEqual([
					[2, 6],
					[1, 6, 0],
					[1, 6, 1],
				]);
			}),
	);
});
