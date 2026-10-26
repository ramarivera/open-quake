import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Fiber, Layer, Option, Ref, TestClock } from "effect";
import {
	HOTKEY_KEYS,
	HOTKEY_MODIFIERS,
	isHotkeyChord,
} from "../../src/actions/action-contracts.js";
import { QuakeDevice } from "../../src/device-service.js";
import {
	fakeHardwareReply,
	makeFakeHardwareTransport,
} from "../../src/hardware/hardware-fake.js";
import {
	defaultHardwarePreferences,
	encodeDeviceChord,
	HardwareControls,
	hardwareKeyboardAdapter,
	luminancePercent,
	sliderToVolume,
	stepLuminance,
	volumeToSlider,
} from "../../src/hardware/index.js";
import type { FakeHidTransport } from "../../src/hid-fake.js";

const setup = (options: Parameters<typeof makeFakeHardwareTransport>[0] = {}) =>
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
			serial: options?.serial ?? "mock-quake",
			session: "session-1",
		});
		return { fake, connection, controls, session };
	});
const commands = (fake: FakeHidTransport) =>
	fake.writes.pipe(
		Effect.map((writes) =>
			writes
				.filter((b) => b[4] !== 0xef)
				.map((b) => [...b.slice(3, 3 + (b[2] ?? 0))]),
		),
	);
const settle = TestClock.adjust(0);

describe("hardware controls over actual device connection with fake transport", () => {
	it.scoped(
		"generic DFU is rejected without a write or poisoning, while enterDfu still owns the transition",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup({
					onCommand: (command) =>
						command.cmdId === 0x2f
							? []
							: [
									fakeHardwareReply(
										command.opCode === 2 ? command.cmdId : 0,
										command.opCode === 2 ? [1, 1, 0, 21] : [0x90],
									),
								],
				});
				const before = yield* fake.writes;
				const sending = yield* session
					.send({ _tag: "Dfu" })
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(3000);
				const result = yield* Fiber.join(sending);
				expect(Either.isLeft(result) && result.left.code).toBe(
					"QUAKE.HARDWARE.COMMAND_REJECTED",
				);
				expect(yield* fake.writes).toEqual(before);
				expect((yield* session.snapshot()).available).toBe(true);
				expect(yield* session.readVersion()).toBe("1.0.21");
				yield* session.enterDfu();
				expect((yield* commands(fake)).filter((b) => b[1] === 0x2f)).toEqual([
					[1, 0x2f, 3],
				]);
				expect((yield* session.snapshot()).available).toBe(false);
			}),
	);

	it.scoped(
		"DFU uses one known command on fake HID and blocks conflicting hardware writes",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup();
				expect(yield* session.readVersion()).toBe("1.0.21");
				yield* session.enterDfu();
				expect((yield* commands(fake)).filter((b) => b[1] === 0x2f)).toEqual([
					[1, 0x2f, 3],
				]);
				expect(
					(yield* session.send({ _tag: "Mic", on: false }).pipe(Effect.either))
						._tag,
				).toBe("Left");
				expect((yield* session.enterDfu().pipe(Effect.either))._tag).toBe(
					"Left",
				);
				expect(
					(yield* commands(fake)).filter((b) => b[1] === 0x2f),
				).toHaveLength(1);
			}),
	);

	it.scoped(
		"queries firmware/mic/luminance, confirms mic ack, clamps native steps and never opens a second handle",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup();
				yield* session.refresh();
				expect((yield* session.snapshot()).firmware).toEqual({
					deviceName: 1,
					major: 1,
					minor: 0,
					patch: 21,
				});
				yield* session.toggleMic();
				expect((yield* session.snapshot()).mic).toBe(false);
				for (let i = 0; i < 12; i++) yield* session.stepBrightness(-1);
				expect((yield* session.snapshot()).luminance).toBe(25);
				expect(luminancePercent(25)).toBe(10);
				expect(yield* fake.opens).toBe(1);
				expect(
					(yield* commands(fake)).filter((b) => b[1] === 5 && b[0] === 1),
				).toHaveLength(9);
			}),
	);
	it.scoped(
		"does not flip mic until success, ignores unrelated replies and retains state on negative ack",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup({
					onCommand: (c) =>
						c.opCode === 2
							? [
									fakeHardwareReply(
										c.cmdId,
										c.cmdId === 46 ? [1, 1, 0, 21] : [c.cmdId === 3 ? 1 : 255],
									),
								]
							: [],
				});
				yield* session.refresh();
				const toggle = yield* session
					.toggleMic()
					.pipe(Effect.either, Effect.fork);
				yield* settle;
				expect((yield* session.snapshot()).mic).toBe(true);
				yield* fake.emit(fakeHardwareReply(5, [100]));
				yield* settle;
				expect(Option.isNone(yield* Fiber.poll(toggle))).toBe(true);
				yield* fake.emit(fakeHardwareReply(0, [0]));
				const failure = yield* Fiber.join(toggle);
				expect(Either.isLeft(failure) && failure.left.code).toBe(
					"QUAKE.HARDWARE.COMMAND_REJECTED",
				);
				expect((yield* session.snapshot()).mic).toBe(true);
			}),
	);
	it.scoped(
		"times out after 3s and rejects late ack reuse without another write",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup({ onCommand: () => [] });
				const refresh = yield* session
					.refresh()
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(3000);
				const result = yield* Fiber.join(refresh);
				expect(Either.isLeft(result) && result.left.code).toBe(
					"QUAKE.HARDWARE.REPLY_TIMEOUT",
				);
				const n = (yield* fake.writes).length;
				yield* fake.emit(fakeHardwareReply(0, [0x90]));
				expect(
					Either.isLeft(
						yield* session
							.send({ _tag: "KnobLed", on: true })
							.pipe(Effect.either),
					),
				).toBe(true);
				expect((yield* fake.writes).length).toBe(n);
			}),
	);
	it.scoped(
		"keeps ordinary reply waits cancellable and refuses late ack reuse",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup({ onCommand: () => [] });
				const sending = yield* session
					.send({ _tag: "KnobLed", on: false })
					.pipe(Effect.fork);
				yield* settle;
				yield* Fiber.interrupt(sending);
				yield* fake.emit(fakeHardwareReply(0, [0x90]));
				expect((yield* session.snapshot()).available).toBe(false);
				expect(
					Either.isLeft(
						yield* session.send({ _tag: "Mic", on: false }).pipe(Effect.either),
					),
				).toBe(true);
				expect(yield* fake.writes).toHaveLength(1);
			}),
	);
	it.scoped(
		"replaces preview at an acknowledgment boundary without poisoning the session",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup({
					onCommand: (c) =>
						c.cmdId === 2 && c.subData[0] !== 0
							? []
							: [fakeHardwareReply(0, [0x90])],
				});
				yield* session.configure({
					...defaultHardwarePreferences,
					alertVolume: 50,
				});
				yield* TestClock.adjust(300);
				const replacing = yield* session
					.configure({ ...defaultHardwarePreferences, alertVolume: 100 })
					.pipe(Effect.fork);
				yield* settle;
				yield* fake.emit(fakeHardwareReply(0, [0x90]));
				yield* Fiber.join(replacing);
				expect((yield* session.snapshot()).available).toBe(true);
				yield* session.send({ _tag: "KnobLed", on: true });
				yield* TestClock.adjust(299);
				expect(yield* commands(fake)).toEqual([
					[1, 2, 50],
					[1, 2, 0],
					[1, 6, 1],
				]);
				yield* TestClock.adjust(1);
				expect((yield* commands(fake)).at(-1)).toEqual([1, 2, 100]);
				yield* fake.emit(fakeHardwareReply(0, [0x90]));
				yield* settle;
				yield* session.configure({
					...defaultHardwarePreferences,
					alertVolume: 0,
				});
			}),
	);
	it.scoped(
		"serial LED policy sends off/on only when stays-on is false; closed sessions cannot write",
		() =>
			Effect.gen(function* () {
				const { fake, connection, session } = yield* setup();
				yield* session.setLocked(true);
				expect(yield* fake.writes).toHaveLength(0);
				yield* session.configure({
					...defaultHardwarePreferences,
					knobLedAlwaysOn: false,
					alertVolume: 0,
				});
				yield* session.setLocked(true);
				yield* session.setLocked(false);
				expect(yield* commands(fake)).toEqual([
					[1, 6, 0],
					[1, 6, 1],
				]);
				yield* connection.disconnect();
				expect(
					Either.isLeft(
						yield* session
							.send({ _tag: "ScreenPower", on: false })
							.pipe(Effect.either),
					),
				).toBe(true);
			}),
	);
	it.scoped(
		"atomic keyboard release runs on interruption and explicit host route uses only host adapter",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup();
				const hostCalls = yield* Ref.make<string[]>([]);
				const keyboard = hardwareKeyboardAdapter(
					session,
					Option.some({
						supportedTokens: new Set(["control", "a"]),
						pressChord: (chord) => Ref.update(hostCalls, (a) => [...a, chord]),
					}),
				);
				const press = yield* keyboard.pressChord("control+a").pipe(Effect.fork);
				yield* settle;
				yield* Fiber.interrupt(press);
				expect(yield* commands(fake)).toEqual([
					[1, 16, 1, 1, 4],
					[1, 16, 0, 1, 4],
				]);
				expect(yield* Ref.get(hostCalls)).toEqual([]);
				yield* session.setInputMode("host");
				yield* keyboard.pressChord("control+a");
				expect(yield* Ref.get(hostCalls)).toEqual(["control+a"]);
				expect(yield* fake.writes).toHaveLength(2);
			}),
	);
	it.scoped(
		"plays recovered tones with configured volume and exact durations/gaps",
		() =>
			Effect.gen(function* () {
				const { fake, session } = yield* setup();
				const tone = yield* session.playTone("start").pipe(Effect.fork);
				yield* settle;
				expect(yield* commands(fake)).toEqual([[1, 2, 84]]);
				yield* TestClock.adjust(99);
				expect(yield* fake.writes).toHaveLength(1);
				yield* TestClock.adjust(1);
				expect(yield* commands(fake)).toEqual([
					[1, 2, 84],
					[1, 2, 0],
				]);
				yield* TestClock.adjust(10);
				expect(yield* commands(fake)).toEqual([
					[1, 2, 84],
					[1, 2, 0],
					[1, 2, 0],
				]);
				yield* TestClock.adjust(130);
				yield* Fiber.join(tone);
				expect(yield* commands(fake)).toEqual([
					[1, 2, 84],
					[1, 2, 0],
					[1, 2, 0],
					[1, 2, 0],
					[1, 2, 84],
					[1, 2, 0],
				]);
			}),
	);
	it.scoped(
		"debounces preview 300ms, persistence 500ms, and restores preferences by serial",
		() =>
			Effect.gen(function* () {
				const { fake, session, controls, connection } = yield* setup();
				yield* session.configure({
					...defaultHardwarePreferences,
					alertVolume: 50,
				});
				yield* TestClock.adjust(200);
				yield* session.configure({
					...defaultHardwarePreferences,
					alertVolume: 100,
				});
				yield* TestClock.adjust(299);
				expect(yield* fake.writes).toHaveLength(0);
				yield* TestClock.adjust(1);
				expect(yield* commands(fake)).toEqual([[1, 2, 100]]);
				yield* TestClock.adjust(500);
				const same = yield* controls.create(connection, {
					serial: "mock-quake",
					session: "s2",
				});
				const other = yield* controls.create(connection, {
					serial: "another-quake",
					session: "s3",
				});
				expect((yield* same.snapshot()).preferences.alertVolume).toBe(100);
				expect((yield* other.snapshot()).preferences.alertVolume).toBe(84);
			}),
	);
});

describe("hardware invariants", () => {
	it("encodes every saved hotkey key and modifier without losing a token", () => {
		const usages = new Set<number>();
		for (const key of HOTKEY_KEYS) {
			expect(isHotkeyChord(key)).toBe(true);
			const encoded = encodeDeviceChord(key);
			expect(Either.isRight(encoded), key).toBe(true);
			if (Either.isLeft(encoded)) continue;
			expect(encoded.right.modifiers).toBe(0);
			expect(encoded.right.usage).toBeGreaterThan(0);
			usages.add(encoded.right.usage);
			for (const modifier of HOTKEY_MODIFIERS) {
				const chord = `${modifier}+${key}`;
				expect(isHotkeyChord(chord)).toBe(true);
				const modified = encodeDeviceChord(chord);
				expect(Either.isRight(modified), chord).toBe(true);
				if (Either.isLeft(modified)) continue;
				expect(modified.right.usage).toBe(encoded.right.usage);
				expect(modified.right.modifiers).toBeGreaterThan(0);
				expect(Math.log2(modified.right.modifiers) % 1).toBe(0);
			}
		}
		expect(usages.size).toBe(HOTKEY_KEYS.length);
		expect(encodeDeviceChord("numlock")).toEqual(
			Either.right({ modifiers: 0, usage: 83 }),
		);
	});
	it("matches the entire slider domain and native brightness bounds", () => {
		expect(sliderToVolume(0)).toBe(0);
		expect(sliderToVolume(1)).toBe(32);
		expect(sliderToVolume(52)).toBe(84);
		expect(sliderToVolume(96)).toBe(128);
		for (let i = 0; i <= 96; i++)
			expect(volumeToSlider(sliderToVolume(i))).toBe(i);
		for (let i = 0; i <= 255; i++)
			for (const d of [-1, 1] as const) {
				const v = stepLuminance(i, d);
				expect(v).toBeGreaterThanOrEqual(25);
				expect(v).toBeLessThanOrEqual(255);
			}
	});
	it("combines all eight modifier bits, rejects extra ordinary keys and unsupported tokens", () => {
		expect(
			encodeDeviceChord(
				"control+shift+alt+command+right_control+right_shift+right_alt+right_command+f24",
			),
		).toEqual(Either.right({ modifiers: 255, usage: 115 }));
		for (const chord of ["a+b", "control+unknown", "", "control++a"])
			expect(Either.isLeft(encodeDeviceChord(chord))).toBe(true);
	});
});
