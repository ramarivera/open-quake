import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, FastCheck as fc, Layer, TestClock } from "effect";
import {
	KnobCapabilityUnavailable,
	KnobDispatchFailed,
} from "../../src/knob/knob-errors.js";
import type {
	KnobModelContext,
	KnobVoiceInput,
	VolumeReading,
} from "../../src/knob/model/contracts.js";
import { volumeStep, wrapIndex } from "../../src/knob/model/invariants.js";
import {
	type KnobModelPort,
	KnobModelPorts,
} from "../../src/knob/model/ports.js";
import { KnobModel } from "../../src/knob/model/service.js";

const thumb = "data:image/png;base64,AA==";
export const modelContext = (ready = true, count = 4): KnobModelContext => ({
	session: {
		deviceId: "preview",
		sessionId: "s1",
		profileId: "p0",
		revision: 0,
	},
	profiles: Array.from({ length: count }, (_, index) => ({
		id: `p${index}`,
		name: `Profile ${index}`,
		colorful: index === 3,
		thumbnail: ready ? { _tag: "ready", dataUrl: thumb } : { _tag: "missing" },
	})),
	keys: ["vol", "luminance", "brightness", "hotkey"]
		.map((kind, index) => ({
			keyCode: `1,${index + 1}`,
			kind,
			visible: true,
			supportKnob: true,
		}))
		.filter(
			(key): key is KnobModelContext["keys"][number] =>
				key.kind === "vol" ||
				key.kind === "luminance" ||
				key.kind === "brightness" ||
				key.kind === "hotkey",
		),
	player: true,
});
const harness = (
	context = modelContext(),
	overrides: Partial<KnobModelPort> = {},
) => {
	const selections: string[] = [];
	const voice: KnobVoiceInput[] = [];
	const turns: { key: string; delta: number }[] = [];
	const writes: VolumeReading[] = [];
	let current = context;
	const ports: KnobModelPort = {
		selectProfile: (profileId) =>
			Effect.sync(() => {
				selections.push(profileId);
				current = {
					...current,
					session: {
						...current.session,
						sessionId: `s${selections.length + 1}`,
						profileId,
					},
				};
				return current;
			}),
		focusedTurn: (key, delta) =>
			Effect.sync(() => {
				turns.push({ key: key.keyCode, delta });
			}),
		voice: (input) =>
			Effect.sync(() => {
				voice.push(input);
			}),
		readVolume: Effect.succeed({ level: 50, muted: false }),
		writeVolume: (reading) =>
			Effect.sync(() => {
				writes.push(reading);
			}),
		warmThumbnails: (profiles) => Effect.succeed(profiles),
		...overrides,
	};
	return {
		selections,
		voice,
		turns,
		writes,
		layer: KnobModel.DefaultWithoutDependencies.pipe(
			Layer.provide(Layer.succeed(KnobModelPorts, ports)),
		),
	};
};
const send = (input: object) =>
	KnobModel.dispatch({ sessionId: "s1", ...input });

describe("knob model uses the real domain ports", () => {
	it.effect("uses exactly one selector for warm and cold thumbnails", () => {
		const h = harness();
		return Effect.gen(function* () {
			yield* KnobModel.configure(modelContext());
			yield* send({ _tag: "Rotate", delta: 1 });
			expect((yield* KnobModel.snapshot()).selector).toMatchObject({
				mode: "picker",
				ringVisible: false,
			});
			yield* KnobModel.configure(modelContext(false));
			yield* send({ _tag: "Rotate", delta: 1 });
			expect((yield* KnobModel.snapshot()).selector).toMatchObject({
				mode: "ring",
				ringVisible: true,
			});
		}).pipe(Effect.provide(h.layer));
	});
	it.effect(
		"publishes catalog-only failures for focused controls and voice, preserving the original failure even when alerting fails",
		() => {
			const failure = KnobCapabilityUnavailable.fromCause(
				new Error("private-native-payload"),
			);
			const alerts: string[] = [];
			const h = harness(modelContext(), {
				focusedTurn: () => Effect.fail(failure),
				voice: () => Effect.fail(failure),
				alert: (code) =>
					Effect.sync(() => {
						alerts.push(code);
					}).pipe(Effect.zipRight(Effect.fail(KnobDispatchFailed.fromCause()))),
			});
			return Effect.gen(function* () {
				yield* KnobModel.configure(modelContext());
				for (const keyCode of ["1,1", "1,2", "1,3", "1,4"]) {
					yield* send({ _tag: "TapTile", keyCode });
					const result = yield* send({ _tag: "Rotate", delta: 1 }).pipe(
						Effect.either,
					);
					expect(result).toMatchObject({
						_tag: "Left",
						left: { code: failure.code },
					});
					const snapshot = yield* KnobModel.snapshot();
					expect(snapshot.notice).toBe(failure.code);
					expect(JSON.stringify(snapshot)).not.toContain(
						"private-native-payload",
					);
				}
				yield* send({ _tag: "Key", code: 5 }).pipe(Effect.either);
				yield* TestClock.adjust(1);
				expect((yield* KnobModel.snapshot()).notice).toBe(failure.code);
				expect(alerts).toEqual(Array(5).fill(failure.code));
				expect(h.selections).toEqual([]);
			}).pipe(Effect.provide(h.layer));
		},
	);
	it.effect(
		"picker commits exactly 5 seconds after the last input and keeps every delta",
		() => {
			const h = harness();
			return Effect.gen(function* () {
				yield* KnobModel.configure(modelContext());
				yield* send({ _tag: "Rotate", delta: 1 });
				yield* TestClock.adjust(4999);
				expect(h.selections).toEqual([]);
				yield* send({ _tag: "Rotate", delta: 1 });
				yield* send({ _tag: "Rotate", delta: 1 });
				yield* TestClock.adjust(4999);
				expect(h.selections).toEqual([]);
				yield* TestClock.adjust(1);
				expect(h.selections).toEqual(["p3"]);
				expect((yield* KnobModel.snapshot()).selector.mode).toBe("closed");
			}).pipe(Effect.provide(h.layer));
		},
	);
	it.effect(
		"cold cache falls through to a 200ms ring commit without replay when thumbnails arrive",
		() =>
			Effect.gen(function* () {
				const warmed = yield* Deferred.make<KnobModelContext["profiles"]>();
				const h = harness(modelContext(false), {
					warmThumbnails: () => Deferred.await(warmed),
				});
				yield* Effect.gen(function* () {
					yield* KnobModel.configure(modelContext(false));
					yield* send({ _tag: "Rotate", delta: 1 });
					expect((yield* KnobModel.snapshot()).selector).toMatchObject({
						mode: "ring",
						index: 1,
						ringVisible: true,
					});
					yield* TestClock.adjust(199);
					expect(h.selections).toEqual([]);
					yield* TestClock.adjust(1);
					expect(h.selections).toEqual(["p1"]);
					yield* Deferred.succeed(warmed, modelContext().profiles);
					yield* TestClock.adjust(2800);
					expect((yield* KnobModel.snapshot()).selector.mode).toBe("closed");
					expect(h.selections).toEqual(["p1"]);
					expect(
						(yield* KnobModel.snapshot()).context.profiles[0]?.thumbnail._tag,
					).toBe("ready");
				}).pipe(Effect.provide(h.layer));
			}),
	);
	it.effect(
		"page arrows follow focus and restart the deadline, confirming current does no write",
		() => {
			const context = modelContext(true, 17);
			const h = harness(context);
			return Effect.gen(function* () {
				yield* KnobModel.configure(context);
				yield* send({ _tag: "Rotate", delta: -1 });
				expect((yield* KnobModel.snapshot()).selector).toMatchObject({
					index: 16,
					page: 1,
				});
				yield* TestClock.adjust(4000);
				yield* send({ _tag: "Page", delta: -1 });
				expect((yield* KnobModel.snapshot()).selector).toMatchObject({
					index: 0,
					page: 0,
				});
				yield* TestClock.adjust(5000);
				expect(h.selections).toEqual([]);
				expect((yield* KnobModel.snapshot()).selector.mode).toBe("closed");
			}).pipe(Effect.provide(h.layer));
		},
	);
	it.effect(
		"short confirms the picker, otherwise interrupts; double dismisses then selects Colorful",
		() => {
			const h = harness();
			return Effect.gen(function* () {
				yield* KnobModel.configure(modelContext());
				yield* send({ _tag: "Rotate", delta: 1 });
				yield* send({ _tag: "Key", code: 1 });
				expect(h.selections).toEqual(["p1"]);
				expect(h.voice).toEqual([]);
				yield* KnobModel.dispatch({ _tag: "Key", sessionId: "s2", code: 1 });
				expect(h.voice.map((v) => v.action)).toEqual(["interrupt"]);
				yield* KnobModel.dispatch({
					_tag: "Rotate",
					sessionId: "s2",
					delta: 1,
				});
				yield* KnobModel.dispatch({ _tag: "Key", sessionId: "s2", code: 2 });
				yield* TestClock.adjust(6000);
				expect(h.selections).toEqual(["p1", "p3"]);
			}).pipe(Effect.provide(h.layer));
		},
	);
	it.effect(
		"firmware hold dismisses picker and forwards one generation, release never invents a press",
		() => {
			const h = harness();
			return Effect.gen(function* () {
				yield* KnobModel.configure(modelContext());
				yield* send({ _tag: "Rotate", delta: 1 });
				for (const code of [5, 5, 255, 255]) yield* send({ _tag: "Key", code });
				yield* TestClock.adjust(6000);
				expect(h.selections).toEqual([]);
				expect(h.voice.map((v) => [v.action, v.generation])).toEqual([
					["holdStart", 1],
					["release", 1],
				]);
			}).pipe(Effect.provide(h.layer));
		},
	);
	it.effect(
		"committed edits preserve the held generation, while selecting another profile cancels it",
		() => {
			const h = harness();
			return Effect.gen(function* () {
				const initial = modelContext();
				yield* KnobModel.configure(initial);
				yield* send({ _tag: "Key", code: 5 });
				yield* KnobModel.configure(
					{
						...initial,
						session: { ...initial.session, revision: 1, sessionId: "edited" },
					},
					true,
				);
				yield* KnobModel.dispatch({
					_tag: "Key",
					sessionId: "edited",
					code: 255,
				});
				expect(h.voice.map((v) => [v.action, v.generation])).toEqual([
					["holdStart", 1],
					["release", 1],
				]);
				yield* KnobModel.dispatch({
					_tag: "Key",
					sessionId: "edited",
					code: 5,
				});
				yield* KnobModel.synchronize({
					...initial,
					session: {
						...initial.session,
						profileId: "p1",
						sessionId: "selected",
					},
				});
				expect(h.voice.map((v) => [v.action, v.generation]).slice(-2)).toEqual([
					["holdStart", 2],
					["cancel", 2],
				]);
			}).pipe(Effect.provide(h.layer));
		},
	);
	it.effect(
		"focus toggles each supported tile and wins over armed player volume",
		() => {
			const h = harness();
			return Effect.gen(function* () {
				yield* KnobModel.configure(modelContext());
				yield* send({ _tag: "ToggleVolume" });
				for (const key of modelContext().keys) {
					yield* send({ _tag: "TapTile", keyCode: key.keyCode });
					yield* send({ _tag: "Rotate", delta: -1 });
					expect((yield* KnobModel.snapshot()).focus).toEqual({
						_tag: "tile",
						keyCode: key.keyCode,
						angle: -12,
					});
				}
				expect(h.turns).toHaveLength(4);
				expect(h.writes).toEqual([]);
				expect(h.selections).toEqual([]);
				yield* send({ _tag: "TapTile", keyCode: "1,4" });
				expect((yield* KnobModel.snapshot()).focus._tag).toBe("none");
				yield* send({ _tag: "TapTile", keyCode: "1,1" });
				yield* send({ _tag: "TapTile", keyCode: "unsupported" });
				expect((yield* KnobModel.snapshot()).focus._tag).toBe("none");
			}).pipe(Effect.provide(h.layer));
		},
	);
	it.effect(
		"volume uses 1 percent steps, ignores recent external updates, mutes zero and disarms on switch",
		() => {
			const h = harness(modelContext(), {
				readVolume: Effect.succeed({ level: 1, muted: false }),
			});
			return Effect.gen(function* () {
				yield* KnobModel.configure(modelContext());
				yield* send({ _tag: "ToggleVolume" });
				yield* send({ _tag: "Rotate", delta: -1 });
				yield* TestClock.adjust(0);
				yield* send({ _tag: "ObservedVolume", level: 80, muted: false });
				yield* send({ _tag: "Rotate", delta: 1 });
				yield* TestClock.adjust(0);
				expect(h.writes).toEqual([
					{ level: 0, muted: true },
					{ level: 1, muted: false },
				]);
				yield* TestClock.adjust(500);
				yield* send({ _tag: "ObservedVolume", level: 80, muted: false });
				expect((yield* KnobModel.snapshot()).volume.level).toBe(80);
				yield* send({ _tag: "Key", code: 2 });
				expect((yield* KnobModel.snapshot()).volume.phase).toBe("inactive");
				yield* KnobModel.dispatch({
					_tag: "Rotate",
					sessionId: "s2",
					delta: 1,
				});
				expect((yield* KnobModel.snapshot()).selector.mode).toBe("picker");
			}).pipe(Effect.provide(h.layer));
		},
	);
	it.effect(
		"slow volume writes coalesce to the latest desired level without blocking detents",
		() =>
			Effect.gen(function* () {
				const first = yield* Deferred.make<void>();
				const writes: number[] = [];
				const h = harness(modelContext(), {
					writeVolume: (reading) =>
						Effect.gen(function* () {
							writes.push(reading.level);
							if (writes.length === 1) yield* Deferred.await(first);
						}),
				});
				yield* Effect.gen(function* () {
					yield* KnobModel.configure(modelContext());
					yield* send({ _tag: "ToggleVolume" });
					yield* send({ _tag: "Rotate", delta: 1 });
					yield* TestClock.adjust(0);
					for (let i = 0; i < 9; i++) yield* send({ _tag: "Rotate", delta: 1 });
					expect(writes).toEqual([51]);
					expect((yield* KnobModel.snapshot()).volume.level).toBe(60);
					yield* Deferred.succeed(first, undefined);
					yield* TestClock.adjust(0);
					expect(writes).toEqual([51, 60]);
				}).pipe(Effect.provide(h.layer));
			}),
	);
	it.effect(
		"a failed asynchronous volume write exposes a catalog code and releases idle rotation",
		() => {
			const h = harness(modelContext(), {
				writeVolume: () =>
					Effect.fail(
						KnobDispatchFailed.fromCause(new Error("private driver cause")),
					),
			});
			return Effect.gen(function* () {
				yield* KnobModel.configure(modelContext());
				yield* send({ _tag: "ToggleVolume" });
				yield* send({ _tag: "Rotate", delta: 1 });
				yield* TestClock.adjust(0);
				const snapshot = yield* KnobModel.snapshot();
				expect(snapshot.volume.phase).toBe("unavailable");
				expect(snapshot.notice).toBe("QUAKE.KNOB.DISPATCH_FAILED");
				expect(JSON.stringify(snapshot)).not.toContain("private driver cause");
				yield* send({ _tag: "Rotate", delta: 1 });
				expect((yield* KnobModel.snapshot()).selector.mode).toBe("picker");
			}).pipe(Effect.provide(h.layer));
		},
	);
	it.effect(
		"failed driver activation remains unavailable and falls through to the selector",
		() => {
			const h = harness(modelContext(), {
				readVolume: Effect.fail(KnobCapabilityUnavailable.fromCause()),
			});
			return Effect.gen(function* () {
				yield* KnobModel.configure(modelContext());
				yield* send({ _tag: "ToggleVolume" });
				expect((yield* KnobModel.snapshot()).volume.phase).toBe("unavailable");
				yield* send({ _tag: "Rotate", delta: 1 });
				expect((yield* KnobModel.snapshot()).selector.mode).toBe("picker");
				expect(h.writes).toEqual([]);
			}).pipe(Effect.provide(h.layer));
		},
	);
	it.effect(
		"replacement cancels captured voice, focus and pending commits; stale events are rejected",
		() => {
			const h = harness();
			return Effect.gen(function* () {
				yield* KnobModel.configure(modelContext());
				yield* send({ _tag: "Key", code: 5 });
				yield* send({ _tag: "Rotate", delta: 1 });
				yield* KnobModel.configure({
					...modelContext(),
					session: { ...modelContext().session, sessionId: "replacement" },
				});
				expect(
					yield* Effect.either(send({ _tag: "Key", code: 255 })),
				).toMatchObject({ _tag: "Left", left: { _tag: "KnobSessionStale" } });
				yield* TestClock.adjust(6000);
				expect(h.selections).toEqual([]);
				expect(h.voice.map((v) => v.action)).toEqual(["holdStart", "cancel"]);
			}).pipe(Effect.provide(h.layer));
		},
	);
	it.effect(
		"failed commit retains active profile and scrubs private adapter causes",
		() => {
			const cause = new Error("token=secret /private/path");
			const error = KnobDispatchFailed.fromCause(cause);
			const h = harness(modelContext(), {
				selectProfile: () => Effect.fail(error),
			});
			return Effect.gen(function* () {
				yield* KnobModel.configure(modelContext());
				yield* send({ _tag: "Rotate", delta: 1 });
				yield* TestClock.adjust(5000);
				const snapshot = yield* KnobModel.snapshot();
				expect(snapshot.context.session.profileId).toBe("p0");
				expect(snapshot.notice).toBe(error.code);
				expect(error.originalCause).toBe(cause);
				expect(JSON.stringify(snapshot)).not.toMatch(/secret|private/);
			}).pipe(Effect.provide(h.layer));
		},
	);
	it.prop(
		"index wrapping and volume bounds hold for arbitrary detent histories",
		[
			fc.integer({ min: -10000, max: 10000 }),
			fc.integer({ min: 1, max: 64 }),
			fc.integer({ min: 0, max: 100 }),
			fc.boolean(),
		],
		([index, length, volume, increase]) => {
			expect(wrapIndex(index, length)).toBeGreaterThanOrEqual(0);
			expect(wrapIndex(index, length)).toBeLessThan(length);
			expect(wrapIndex(index + length, length)).toBe(wrapIndex(index, length));
			expect(volumeStep(volume, increase ? 1 : -1)).toBe(
				Math.min(100, Math.max(0, volume + (increase ? 1 : -1))),
			);
		},
	);
});
