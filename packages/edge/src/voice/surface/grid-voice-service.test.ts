import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer, Option, TestClock } from "effect";
import { GridVoice } from "./grid-voice-service.js";
import { MockVoiceRuntimeLive } from "./mock-voice-runtime.js";
import type {
	GridVoiceInput,
	VoiceSurfaceEvent,
	VoiceTone,
} from "./voice-surface-contracts.js";
import { VoiceRuntimeUnavailable } from "./voice-surface-errors.js";
import {
	GridVoiceRuntime,
	VoiceSurfacePublisher,
	VoiceTonePort,
} from "./voice-surface-ports.js";
import { VoiceSurface } from "./voice-surface-service.js";

interface Recorder {
	readonly events: VoiceSurfaceEvent[];
	readonly tones: VoiceTone[];
	readonly calls: string[];
}
const recorder = (): Recorder => ({ events: [], tones: [], calls: [] });

const portsLayer = (rec: Recorder) =>
	Layer.mergeAll(
		Layer.succeed(VoiceSurfacePublisher, {
			publish: (event) => Effect.sync(() => void rec.events.push(event)),
		}),
		Layer.succeed(VoiceTonePort, {
			play: (_serial, tone) => Effect.sync(() => void rec.tones.push(tone)),
		}),
	);
/** Records runtime calls; `startCapture` fails when `available` is false. */
const fakeRuntime = (rec: Recorder, available = true) =>
	Layer.succeed(GridVoiceRuntime, {
		select: (_s, keyCode) =>
			Effect.sync(() => void rec.calls.push(`select ${keyCode}`)),
		startCapture: (request) =>
			available
				? Effect.sync(
						() =>
							void rec.calls.push(
								`start ${request.keyCode} #${request.generation}`,
							),
					)
				: Effect.fail(new VoiceRuntimeUnavailable()),
		releaseCapture: (_s, keyCode, generation) =>
			Effect.sync(
				() => void rec.calls.push(`release ${keyCode} #${generation}`),
			),
		cancelCapture: (_s, keyCode, generation) =>
			Effect.sync(
				() => void rec.calls.push(`cancel ${keyCode} #${generation}`),
			),
		cancelFlow: (_s, keyCode) =>
			Effect.sync(() => void rec.calls.push(`cancelFlow ${keyCode}`)),
		sendText: () => Effect.void,
	});
const stack = (
	rec: Recorder,
	runtime: Layer.Layer<GridVoiceRuntime, never, VoiceSurface>,
) =>
	GridVoice.Default.pipe(
		Layer.provideMerge(
			runtime.pipe(
				Layer.provideMerge(
					VoiceSurface.Default.pipe(Layer.provide(portsLayer(rec))),
				),
			),
		),
	);

const input = (
	keyCode: string,
	kind: GridVoiceInput["kind"],
): GridVoiceInput => ({ keyCode, kind, type: "aiChat" });
const at = (ms: number) => TestClock.adjust(Duration.millis(ms));

describe("GridVoice", () => {
	it.scoped(
		"starts at 1000 ms and releases 350 ms after the touch ends",
		() => {
			const rec = recorder();
			return Effect.gen(function* () {
				yield* GridVoice.input("QK", input("1,6", "down"));
				yield* at(999);
				expect(rec.calls).toEqual(["select 1,6"]);
				yield* at(1);
				expect(rec.calls).toEqual(["select 1,6", "start 1,6 #1"]);
				yield* at(1400);
				yield* GridVoice.input("QK", input("1,6", "touchEnd"));
				yield* at(349);
				expect(rec.calls).not.toContain("release 1,6 #1");
				yield* at(1);
				expect(rec.calls).toEqual([
					"select 1,6",
					"start 1,6 #1",
					"release 1,6 #1",
				]);
				expect(
					rec.events
						.filter((event) => event._tag === "KeyPress")
						.map((event) => (event._tag === "KeyPress" ? event.action : "")),
				).toEqual(["down", "up"]);
			}).pipe(Effect.provide(stack(rec, fakeRuntime(rec))));
		},
	);

	it.scoped("keeps capturing when the finger returns inside the grace", () => {
		const rec = recorder();
		return Effect.gen(function* () {
			yield* GridVoice.input("QK", input("1,6", "down"));
			yield* at(1500);
			yield* GridVoice.input("QK", input("1,6", "touchEnd"));
			yield* at(200);
			yield* GridVoice.input("QK", input("1,6", "down"));
			yield* at(5000);
			expect(rec.calls).toEqual(["select 1,6", "start 1,6 #1"]);
		}).pipe(Effect.provide(stack(rec, fakeRuntime(rec))));
	});

	it.scoped(
		"rejects a second key with the busy stage, tone, alert and toast",
		() => {
			const rec = recorder();
			return Effect.gen(function* () {
				yield* GridVoice.input("QK", input("1,6", "down"));
				yield* at(1200);
				yield* GridVoice.input("QK", input("1,7", "down"));
				expect(rec.calls).toEqual(["select 1,6", "start 1,6 #1"]);
				expect(rec.tones).toEqual(["busy"]);
				const tags = rec.events.map((event) => event._tag);
				expect(tags).toEqual(
					expect.arrayContaining(["Stage", "KeyAlert", "Toast"]),
				);
				const alert = rec.events.find((event) => event._tag === "KeyAlert");
				expect(alert?._tag === "KeyAlert" && alert.keyCode).toBe("1,7");
			}).pipe(Effect.provide(stack(rec, fakeRuntime(rec))));
		},
	);

	it.scoped("ignores touch cancel until a real touch end", () => {
		const rec = recorder();
		return Effect.gen(function* () {
			yield* GridVoice.input("QK", input("1,6", "down"));
			yield* at(1500);
			yield* GridVoice.input("QK", input("1,6", "touchCancel"));
			yield* at(5000);
			expect(rec.calls).not.toContain("release 1,6 #1");
			yield* GridVoice.input("QK", input("1,6", "touchEnd"));
			yield* at(350);
			expect(rec.calls).toContain("release 1,6 #1");
		}).pipe(Effect.provide(stack(rec, fakeRuntime(rec))));
	});

	it.scoped("cancels a running capture on reset and disarms its timers", () => {
		const rec = recorder();
		return Effect.gen(function* () {
			yield* GridVoice.input("QK", input("1,6", "down"));
			yield* at(1500);
			yield* GridVoice.reset("QK");
			yield* GridVoice.input("QK", input("1,7", "down"));
			yield* GridVoice.reset("QK");
			yield* at(5000);
			expect(rec.calls).toEqual([
				"select 1,6",
				"start 1,6 #1",
				"cancel 1,6 #1",
				"select 1,7",
			]);
		}).pipe(Effect.provide(stack(rec, fakeRuntime(rec))));
	});

	it.scoped(
		"publishes failed/unavailable with the error tone and alert when no runtime exists",
		() => {
			const rec = recorder();
			return Effect.gen(function* () {
				yield* GridVoice.input("QK", input("1,6", "down"));
				yield* at(1000);
				const failed = rec.events.find(
					(event) => event._tag === "Stage" && event.stage._tag === "failed",
				);
				expect(failed).toMatchObject({
					keyCode: "1,6",
					stage: {
						_tag: "failed",
						reason: "unavailable",
						errorCode: "VOICE.GRID.RUNTIME_UNAVAILABLE",
					},
				});
				expect(rec.tones).toEqual(["error"]);
				expect(rec.events.some((event) => event._tag === "KeyAlert")).toBe(
					true,
				);
			}).pipe(Effect.provide(stack(rec, fakeRuntime(rec, false))));
		},
	);

	it.scoped("cancels the key's own flow on tap while processing", () => {
		const rec = recorder();
		return Effect.gen(function* () {
			yield* VoiceSurface.publish({
				_tag: "Stage",
				serial: "QK",
				keyCode: "1,6",
				captureId: "x",
				stage: { _tag: "processing" },
			});
			yield* GridVoice.input("QK", input("1,6", "down"));
			expect(rec.calls).toEqual(["cancelFlow 1,6"]);
		}).pipe(Effect.provide(stack(rec, fakeRuntime(rec))));
	});
});

describe("mock voice runtime", () => {
	it.scoped("scripts a full turn under TestClock", () => {
		const rec = recorder();
		return Effect.gen(function* () {
			yield* GridVoice.input("QK", input("1,6", "down"));
			yield* at(1000);
			yield* at(300);
			yield* at(1200);
			yield* GridVoice.input("QK", input("1,6", "touchEnd"));
			yield* at(350);
			yield* at(60 * 10);
			const phases = rec.events.flatMap((event) =>
				event._tag === "Stage"
					? [
							event.stage._tag === "recording"
								? `recording/${event.stage.status}`
								: event.stage._tag === "idle"
									? `idle/${event.stage.outcome}`
									: event.stage._tag,
						]
					: event._tag === "TurnStarted"
						? ["TurnStarted"]
						: [],
			);
			// Partials arrive every 400 ms; how many depends on the hold length.
			expect(
				phases.filter((phase) => phase === "recording/speaking").length,
			).toBeGreaterThanOrEqual(3);
			expect(
				phases.filter(
					(phase, index) =>
						phase !== "recording/speaking" ||
						phases[index - 1] !== "recording/speaking",
				),
			).toEqual([
				"recording/preparing",
				"recording/listening",
				"recording/speaking",
				"processing",
				"TurnStarted",
				"idle/completed",
			]);
			const chunks = rec.events.filter((event) => event._tag === "Chunk");
			expect(chunks.length).toBe(8);
			expect(chunks.at(-1)).toMatchObject({
				chunk: { type: "end", outcome: "completed" },
			});
			const levels = rec.events.filter((event) => event._tag === "Level");
			expect(levels.length).toBeGreaterThan(20);
			expect(rec.tones).toEqual(["start", "end"]);
			const processing = rec.events.find(
				(event) => event._tag === "Stage" && event.stage._tag === "processing",
			);
			expect(processing).toMatchObject({
				stage: { transcript: expect.stringContaining("weather") },
			});
		}).pipe(Effect.provide(stack(rec, MockVoiceRuntimeLive)));
	});

	it.scoped("ignores a release from an older generation", () => {
		const rec = recorder();
		return Effect.gen(function* () {
			const runtime = yield* GridVoiceRuntime;
			yield* runtime.startCapture({
				serial: "QK",
				keyCode: "1,6",
				captureId: "1,6/2",
				generation: 2,
				type: "aiChat",
				agentId: Option.none(),
			});
			yield* at(400);
			yield* runtime.releaseCapture("QK", "1,6", 1);
			yield* at(200);
			expect(
				rec.events.some(
					(event) =>
						event._tag === "Stage" && event.stage._tag === "processing",
				),
			).toBe(false);
			yield* runtime.cancelCapture("QK", "1,6", 2);
			expect(rec.events.at(-1)).toMatchObject({
				stage: { _tag: "idle", outcome: "cancelled" },
			});
		}).pipe(Effect.provide(stack(rec, MockVoiceRuntimeLive)));
	});
});
