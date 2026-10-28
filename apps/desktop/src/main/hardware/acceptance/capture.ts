import assert from "node:assert/strict";
import type { HardwareCommand, HardwareReply } from "@open-quake/protocol";
import { Effect, Exit, Fiber, Layer, Option, Scope, Stream } from "effect";
import type { DeviceEvent } from "../../../../../../packages/device/src/device-contracts.js";
import { canonicalHidSerial } from "../../../../../../packages/device/src/device-contracts.js";
import { QuakeHidOpenFailed } from "../../../../../../packages/device/src/device-errors.js";
import {
	type QuakeConnection,
	QuakeDevice,
} from "../../../../../../packages/device/src/device-service.js";
import { HidTransport } from "../../../../../../packages/device/src/hid-transport.js";
import { isTouchDevice } from "../../../../../../packages/device/src/touch/touch-contracts.js";
import { safeCause } from "../../diagnostics/privacy.js";
import { assertNoSerial } from "./probe.js";

/** One decoded input observation. */
export type CaptureObservation =
	| { readonly kind: "matrix"; readonly pressed: readonly number[] }
	| { readonly kind: "knob"; readonly delta: number }
	| { readonly kind: "knob-press"; readonly state: number }
	| {
			readonly kind: "touch";
			readonly points: ReadonlyArray<{
				readonly id: string;
				readonly action: number;
				readonly x: number;
				readonly y: number;
			}>;
	  }
	| { readonly kind: "disconnect"; readonly reason: string }
	| { readonly kind: "reconnected" }
	| { readonly kind: "light"; readonly what: string; readonly value: number }
	| { readonly kind: "other"; readonly tag: string };
/** An observation timestamped from capture start and tagged with its step. */
export type CaptureEvent = CaptureObservation & {
	readonly t: number;
	readonly step: string;
};

export interface CaptureStep {
	readonly id: string;
	readonly say: string;
	readonly timeoutMs: number;
	/** Runs once after the prompt, for steps the agent drives itself. */
	readonly lights?: true;
	readonly done: (
		mine: readonly CaptureEvent[],
		all: readonly CaptureEvent[],
	) => boolean;
}

const of = <K extends CaptureEvent["kind"]>(
	events: readonly CaptureEvent[],
	kind: K,
) =>
	events.filter(
		(event): event is Extract<CaptureEvent, { kind: K }> => event.kind === kind,
	);

const tapped = (mine: readonly CaptureEvent[]) => {
	const touches = of(mine, "touch").flatMap((event) => event.points);
	const down = touches.findIndex((point) => point.action === 1);
	return down >= 0 && touches.slice(down).some((point) => point.action === 0);
};
const knobSign = (events: readonly CaptureEvent[]) =>
	Math.sign(of(events, "knob").reduce((sum, event) => sum + event.delta, 0));
const KEY_COUNT = 15;

/** The guided sequence. Prompts are spoken; each step advances on its evidence. */
export const CAPTURE_STEPS: readonly CaptureStep[] = [
	{
		id: "keys",
		say: "Step one. Press each of the fifteen keys once, one at a time, left to right, starting with the top row.",
		timeoutMs: 90_000,
		done: (mine) => {
			const matrix = of(mine, "matrix");
			const seen = new Set(matrix.flatMap((event) => event.pressed));
			return seen.size >= KEY_COUNT && matrix.at(-1)?.pressed.length === 0;
		},
	},
	{
		id: "knob-left",
		say: "Step two. Turn the knob to the left, five clicks.",
		timeoutMs: 30_000,
		done: (mine) =>
			Math.abs(of(mine, "knob").reduce((s, e) => s + e.delta, 0)) >= 5,
	},
	{
		id: "knob-right",
		say: "Step three. Now turn the knob to the right, five clicks.",
		timeoutMs: 30_000,
		done: (mine, all) => {
			const left = knobSign(all.filter((event) => event.step === "knob-left"));
			const sum = of(mine, "knob").reduce((s, e) => s + e.delta, 0);
			return Math.abs(sum) >= 5 && Math.sign(sum) !== left;
		},
	},
	{
		id: "knob-press",
		say: "Step four. Press the knob down and let go, three times.",
		timeoutMs: 30_000,
		done: (mine) => {
			const states = of(mine, "knob-press").map((event) => event.state);
			return (
				states.filter(
					(state, index) => index > 0 && state !== states[index - 1],
				).length >= 5 || states.length >= 6
			);
		},
	},
	...(
		[
			["touch-top-left", "the top left corner"],
			["touch-top-right", "the top right corner"],
			["touch-bottom-right", "the bottom right corner"],
			["touch-bottom-left", "the bottom left corner"],
			["touch-center", "the center"],
		] as const
	).map(
		([id, where], index): CaptureStep => ({
			id,
			say: `${index === 0 ? "Step five. Touch screen. " : ""}Tap ${where} of the screen once.`,
			timeoutMs: 20_000,
			done: tapped,
		}),
	),
	{
		id: "swipe",
		say: "Swipe one finger from the left edge of the screen to the right edge.",
		timeoutMs: 20_000,
		done: (mine) => {
			const xs = of(mine, "touch")
				.flatMap((event) => event.points)
				.filter((point) => point.action === 1)
				.map((point) => point.x);
			return (
				xs.length > 1 &&
				Math.max(...xs) - Math.min(...xs) >= 600 &&
				tapped(mine)
			);
		},
	},
	{
		id: "lights",
		say: "Step six. Hands off. Watch the knob light blink three times, then watch the screen dim and brighten. Remember what you saw.",
		timeoutMs: 30_000,
		lights: true,
		done: (mine) =>
			of(mine, "light").some((event) => event.what === "restored"),
	},
	{
		id: "unplug",
		say: "Step seven. Unplug the QUAKE's USB cable now.",
		timeoutMs: 60_000,
		done: (mine) => of(mine, "disconnect").length > 0,
	},
	{
		id: "replug",
		say: "Plug the cable back in.",
		timeoutMs: 90_000,
		// A fast re-enumeration can reconnect before this prompt finishes.
		done: (_mine, all) => {
			const drop = all.map((event) => event.kind).lastIndexOf("disconnect");
			return (
				drop >= 0 &&
				all.slice(drop).some((event) => event.kind === "reconnected")
			);
		},
	},
	{
		id: "key-after-replug",
		say: "Press any one key.",
		timeoutMs: 30_000,
		done: (mine) =>
			of(mine, "matrix").some((event) => event.pressed.length > 0),
	},
	{
		id: "touch-after-replug",
		say: "Tap the screen once.",
		timeoutMs: 30_000,
		done: tapped,
	},
];

/** The control handle must be the selected QUAKE; the touch controller is read-only. */
export function captureTransport(
	source: HidTransport["Type"],
	serial: string,
): HidTransport["Type"] {
	return {
		...source,
		open: (info) =>
			isTouchDevice(info) ||
			canonicalHidSerial(info.serialNumber ?? "") === serial
				? source.open(info)
				: Effect.fail(new QuakeHidOpenFailed(undefined)),
	};
}

export function toCaptureEvent(
	event: DeviceEvent,
): CaptureObservation | undefined {
	switch (event._tag) {
		case "Matrix":
			return {
				kind: "matrix",
				pressed: event.matrix.states.flatMap((value, index) =>
					value ? [index] : [],
				),
			};
		case "KnobRotate":
			return { kind: "knob", delta: event.delta };
		case "KnobPress":
			return { kind: "knob-press", state: event.state };
		case "Touch":
			return {
				kind: "touch",
				points: event.points.map((point) => ({
					id: point.touchId ?? "",
					action: point.action,
					x: point.x,
					y: point.y,
				})),
			};
		case "Disconnect":
			return { kind: "disconnect", reason: event.reason };
		case "KeepAlive":
		case "HardwareReply":
			return undefined;
		default:
			return { kind: "other", tag: event._tag };
	}
}

/** Supervised physical input capture. Writes only knob LED and luminance, restored. */
export const runInputCapture = Effect.fn("HardwareAcceptance.capture")(
	function* (options: {
		readonly serial: string;
		readonly steps: readonly CaptureStep[];
		readonly announce: (text: string) => Effect.Effect<void>;
		readonly lightDelayMs?: number;
		readonly reconnectDelayMs?: number;
	}) {
		const lightDelay = options.lightDelayMs ?? 700;
		const start = performance.now();
		const events: CaptureEvent[] = [];
		let step = "start";
		const record = (event: CaptureObservation) =>
			events.push({
				...event,
				t: Math.round(performance.now() - start),
				step,
			} as CaptureEvent);
		const transport = Layer.succeed(
			HidTransport,
			captureTransport(yield* HidTransport, options.serial),
		);
		const device = yield* QuakeDevice.pipe(
			Effect.provide(
				QuakeDevice.DefaultWithoutDependencies.pipe(Layer.provide(transport)),
			),
		);
		let current:
			| { connection: QuakeConnection; scope: Scope.CloseableScope }
			| undefined;
		const connect = Effect.gen(function* () {
			const selected = (yield* device.discover()).filter(
				(info) => info.serialNumber === options.serial,
			);
			const info = selected[0];
			if (selected.length !== 1 || !info) return false;
			const scope = yield* Scope.make();
			const opened = yield* Effect.exit(
				Effect.gen(function* () {
					const connection = yield* device.connect({ path: info.path });
					const stream = yield* connection.subscribe();
					yield* Stream.runForEach(stream, (event) =>
						Effect.sync(() => {
							const mapped = toCaptureEvent(event);
							if (mapped) record(mapped);
						}),
					).pipe(Effect.ignore, Effect.forkIn(scope));
					return connection;
				}).pipe(Scope.extend(scope)),
			);
			if (Exit.isFailure(opened)) {
				yield* Scope.close(scope, opened);
				return false;
			}
			current = { connection: opened.value, scope };
			return true;
		});
		assert(yield* connect, "Expected one exact QUAKE");
		yield* Effect.addFinalizer(() =>
			current ? Scope.close(current.scope, Exit.void) : Effect.void,
		);
		// After a disconnect, keep rediscovering until the same device returns.
		const reconnector = yield* Effect.gen(function* () {
			let handled = 0;
			while (true) {
				yield* Effect.sleep(options.reconnectDelayMs ?? 500);
				const drops = of(events, "disconnect").length;
				if (drops === handled) continue;
				if (current) {
					yield* Scope.close(current.scope, Exit.void);
					current = undefined;
				}
				if (yield* connect.pipe(Effect.orElseSucceed(() => false))) {
					handled = drops;
					record({ kind: "reconnected" });
				}
			}
		}).pipe(Effect.forkScoped);

		const exchange = (command: HardwareCommand, tag: HardwareReply["_tag"]) =>
			Effect.scoped(
				Effect.gen(function* () {
					assert(current, "No connection");
					const stream = yield* current.connection.subscribe();
					const waiter = yield* Stream.runHead(
						stream.pipe(
							Stream.filter(
								(event) =>
									event._tag === "HardwareReply" && event.reply._tag === tag,
							),
						),
					).pipe(Effect.forkScoped);
					yield* current.connection.sendHardware(command);
					const event = yield* Fiber.join(waiter).pipe(
						Effect.timeoutFail({
							duration: "4 seconds",
							onTimeout: () => new Error(`No ${tag} reply`),
						}),
					);
					assert(Option.isSome(event) && event.value._tag === "HardwareReply");
					return event.value.reply;
				}),
			);
		const knobLed = exchange(
			{ _tag: "Query", feature: "knobLed" },
			"KnobLedState",
		).pipe(Effect.map((reply) => reply._tag === "KnobLedState" && reply.on));
		const luminance = exchange(
			{ _tag: "Query", feature: "luminance" },
			"LuminanceState",
		).pipe(
			Effect.map((reply) =>
				reply._tag === "LuminanceState" ? reply.value : -1,
			),
		);
		const set = (
			command: Extract<HardwareCommand, { _tag: "KnobLed" | "Luminance" }>,
		) =>
			exchange(command, "Ack").pipe(
				Effect.tap(() =>
					Effect.sync(() =>
						record({
							kind: "light",
							what: command._tag,
							value:
								command._tag === "KnobLed" ? Number(command.on) : command.value,
						}),
					),
				),
			);
		const lights = Effect.gen(function* () {
			const led = yield* knobLed;
			const level = yield* luminance;
			assert(level >= 25, "Luminance below the reversible range");
			yield* Effect.gen(function* () {
				for (let index = 0; index < 6; index++) {
					yield* set({ _tag: "KnobLed", on: index % 2 === 0 ? !led : led });
					yield* Effect.sleep(lightDelay);
				}
				for (const value of [25, 255]) {
					yield* set({ _tag: "Luminance", value });
					yield* Effect.sleep(lightDelay * 3);
				}
			}).pipe(
				Effect.ensuring(
					Effect.gen(function* () {
						yield* set({ _tag: "KnobLed", on: led });
						yield* set({ _tag: "Luminance", value: level });
						assert.equal(yield* knobLed, led, "Knob LED not restored");
						assert.equal(yield* luminance, level, "Luminance not restored");
						record({ kind: "light", what: "restored", value: level });
					}).pipe(Effect.orDie),
				),
			);
		});

		const results: Array<{
			readonly id: string;
			readonly status: "passed" | "timed-out" | "failed";
			readonly ms: number;
			readonly cause?: object;
		}> = [];
		for (const item of options.steps) {
			step = item.id;
			const began = performance.now();
			yield* options.announce(item.say);
			const mineFrom = events.length;
			const action = item.lights ? yield* Effect.exit(lights) : Exit.void;
			if (Exit.isFailure(action)) {
				results.push({
					id: item.id,
					status: "failed",
					ms: Math.round(performance.now() - began),
					cause: safeCause(action.cause),
				});
				continue;
			}
			const deadline = began + item.timeoutMs;
			let passed = false;
			while (performance.now() < deadline) {
				if (item.done(events.slice(mineFrom), events)) {
					passed = true;
					break;
				}
				yield* Effect.sleep(100);
			}
			results.push({
				id: item.id,
				status: passed ? "passed" : "timed-out",
				ms: Math.round(performance.now() - began),
			});
		}
		step = "end";
		yield* options.announce("All done. Thank you.");
		yield* Fiber.interrupt(reconnector);
		const evidence = { steps: results, events };
		assertNoSerial(evidence, options.serial);
		return {
			checks: results.map((result) => ({
				id: result.id,
				status:
					result.status === "passed"
						? ("passed" as const)
						: ("failed" as const),
				...(result.status === "timed-out" ? { reason: "timed out" } : {}),
				...(result.cause ? { cause: result.cause } : {}),
			})),
			evidence,
		};
	},
);
