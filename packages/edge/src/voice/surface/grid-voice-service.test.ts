import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Duration,
	Effect,
	Fiber,
	Layer,
	Option,
	TestClock,
} from "effect";
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
	VoiceAdmission,
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
	for (const knobFirst of [true, false])
		it.scoped(
			`reserves ${knobFirst ? "knob" : "grid"} capture while its adapter is deferred and before any Stage`,
			() => {
				const rec = recorder();
				return Effect.gen(function* () {
					const started = yield* Deferred.make<void>();
					const finishStart = yield* Deferred.make<void>();
					const delayed = Layer.succeed(GridVoiceRuntime, {
						select: () => Effect.void,
						startCapture: (request) =>
							Effect.gen(function* () {
								rec.calls.push(`start ${request.keyCode}`);
								yield* Deferred.succeed(started, undefined);
								yield* Deferred.await(finishStart);
							}),
						releaseCapture: () => Effect.void,
						cancelCapture: () => Effect.void,
						cancelFlow: () => Effect.void,
						sendText: () => Effect.void,
					});
					yield* Effect.gen(function* () {
						if (!knobFirst) yield* GridVoice.input("QK", input("1,6", "down"));
						const first = yield* (
							knobFirst ? GridVoice.knob("QK", "holdStart", 1) : at(1000)
						).pipe(Effect.forkScoped);
						yield* Deferred.await(started);
						const contender = yield* (
							knobFirst
								? GridVoice.input("QK", input("1,6", "down"))
								: GridVoice.knob("QK", "holdStart", 1)
						).pipe(Effect.forkScoped);
						yield* Effect.yieldNow();
						expect(rec.calls).toEqual([`start ${knobFirst ? "0,1" : "1,6"}`]);
						yield* Deferred.succeed(finishStart, undefined);
						yield* Fiber.join(first);
						yield* Fiber.join(contender);
						yield* at(2000);
						expect(rec.calls).toHaveLength(1);
						expect(rec.events).toContainEqual(
							expect.objectContaining({
								_tag: "Stage",
								keyCode: knobFirst ? "1,6" : "0,1",
								stage: { _tag: "busy" },
							}),
						);
						expect(yield* VoiceSurface.activeFlow("QK")).toEqual(
							Option.some(knobFirst ? "0,1" : "1,6"),
						);
						yield* GridVoice.reset("QK", "disconnected");
						expect(yield* VoiceSurface.activeFlow("QK")).toEqual(Option.none());
					}).pipe(Effect.provide(stack(rec, delayed)));
				});
			},
		);
	it.scoped(
		"disconnect cancels a capture inside release grace without submitting it",
		() => {
			const rec = recorder();
			return Effect.gen(function* () {
				yield* GridVoice.input("QK", input("1,6", "down"));
				yield* at(1500);
				yield* GridVoice.input("QK", input("1,6", "touchEnd"));
				yield* at(349);
				yield* GridVoice.reset("QK", "disconnected");
				yield* at(5000);
				expect(
					rec.events.some(
						(event) =>
							event._tag === "TurnStarted" ||
							event._tag === "Chunk" ||
							(event._tag === "Stage" && event.stage._tag === "processing"),
					),
				).toBe(false);
				expect(rec.events.at(-1)).toEqual({
					_tag: "Reset",
					serial: "QK",
					reason: "disconnected",
				});
				expect(rec.events).toContainEqual(
					expect.objectContaining({
						_tag: "Stage",
						keyCode: "1,6",
						stage: { _tag: "idle", outcome: "cancelled" },
					}),
				);
				expect(yield* VoiceSurface.activeFlow("QK")).toEqual(Option.none());
			}).pipe(Effect.provide(stack(rec, MockVoiceRuntimeLive)));
		},
	);
	it.scoped(
		"disconnect before the long press prevents capture and frees the next generation",
		() => {
			const rec = recorder();
			return Effect.gen(function* () {
				yield* GridVoice.input("QK", input("1,6", "down"));
				yield* at(999);
				yield* GridVoice.reset("QK", "disconnected");
				yield* at(5000);
				expect(rec.calls).toEqual(["select 1,6"]);
				yield* GridVoice.input("QK", input("1,7", "down"));
				yield* at(1000);
				expect(rec.calls).toEqual(["select 1,6", "select 1,7", "start 1,7 #2"]);
			}).pipe(Effect.provide(stack(rec, fakeRuntime(rec))));
		},
	);
	it.scoped("selects typed-only assistants without arming hold-to-talk", () => {
		const rec = recorder();
		return Effect.gen(function* () {
			for (const kind of ["down", "touchEnd"] as const)
				yield* GridVoice.input("QK", {
					keyCode: "1,5",
					type: "clawbot",
					voiceInput: false,
					agentId: "weather",
					kind,
				});
			yield* at(2000);
			expect(rec.calls).toEqual(["select 1,5"]);
			expect(rec.events).toEqual([
				{ _tag: "KeyPress", serial: "QK", keyCode: "1,5", action: "down" },
				{ _tag: "KeyPress", serial: "QK", keyCode: "1,5", action: "up" },
			]);
			yield* GridVoice.knob("QK", "holdStart", 1);
			expect(rec.calls).toContain("start 0,1 #1");
		}).pipe(Effect.provide(stack(rec, fakeRuntime(rec))));
	});
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
				expect(yield* VoiceSurface.activeFlow("QK")).toEqual(Option.none());
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

describe("knob voice seam", () => {
	it.scoped("starts, releases and interrupts knob captures", () => {
		const rec = recorder();
		return Effect.gen(function* () {
			yield* GridVoice.knob("QK", "holdStart", 3);
			yield* GridVoice.knob("QK", "release", 3);
			yield* GridVoice.knob("QK", "interrupt", 3);
			yield* GridVoice.knob("QK", "cancel", 4);
			expect(rec.calls).toEqual([
				"start 0,1 #3",
				"release 0,1 #3",
				"cancelFlow 0,1",
				"cancel 0,1 #4",
			]);
		}).pipe(Effect.provide(stack(rec, fakeRuntime(rec))));
	});

	it.scoped(
		"rejects a knob hold while a grid key holds voice, with the previous-turn toast",
		() => {
			const rec = recorder();
			return Effect.gen(function* () {
				yield* GridVoice.input("QK", input("1,6", "down"));
				yield* GridVoice.knob("QK", "holdStart", 1);
				expect(rec.calls).toEqual(["select 1,6"]);
				expect(rec.tones).toEqual(["busy"]);
				expect(rec.events.at(-1)).toMatchObject({
					_tag: "Toast",
					messageKey: "aiAudio.prevTurnBusy",
				});
				// The knob key has no tile to flash.
				expect(rec.events.some((event) => event._tag === "KeyAlert")).toBe(
					false,
				);
			}).pipe(Effect.provide(stack(rec, fakeRuntime(rec))));
		},
	);

	it.scoped(
		"delegates same-device cleanup to the bounded capture owner",
		() => {
			const rec = recorder();
			return Effect.gen(function* () {
				yield* VoiceSurface.publish({
					_tag: "Stage",
					serial: "QK",
					keyCode: "0,1",
					captureId: "old",
					stage: { _tag: "processing" },
				});
				yield* GridVoice.knob("QK", "holdStart", 2);
				expect(rec.calls).toEqual(["start 0,1 #2"]);
			}).pipe(Effect.provide(stack(rec, fakeRuntime(rec))));
		},
	);

	it.scoped("shows the error countdown when no knob runtime exists", () => {
		const rec = recorder();
		return Effect.gen(function* () {
			yield* GridVoice.knob("QK", "holdStart", 1);
			expect(rec.events[0]).toMatchObject({
				keyCode: "0,1",
				stage: { _tag: "failed", reason: "unavailable" },
			});
			expect(rec.tones).toEqual(["error"]);
			expect(yield* VoiceSurface.activeFlow("QK")).toEqual(Option.none());
		}).pipe(Effect.provide(stack(rec, fakeRuntime(rec, false))));
	});
});

describe("mock voice runtime", () => {
	it.scoped(
		"interrupts the grid capture once and ignores wrong-key release and stale cancellation",
		() => {
			const rec = recorder();
			return Effect.gen(function* () {
				const runtime = yield* GridVoiceRuntime;
				yield* GridVoice.input("QK", input("1,6", "down"));
				yield* at(1400);
				const before = rec.events.length;
				yield* GridVoice.knob("QK", "interrupt", 1);
				yield* runtime.cancelCapture("QK", "0,1", 1);
				yield* runtime.cancelCapture("QK", "1,6", 0);
				yield* runtime.releaseCapture("QK", "0,1", 1);
				yield* at(300);
				expect(
					rec.events
						.slice(before)
						.some((event) => event._tag === "Level" && event.keyCode === "1,6"),
				).toBe(false);
				expect(
					rec.events.filter(
						(event) => event._tag === "Stage" && event.stage._tag === "idle",
					),
				).toHaveLength(1);
				expect(yield* VoiceSurface.activeFlow("QK")).toEqual(Option.none());
				yield* runtime.cancelCapture("QK", "1,6", 1);
				expect(rec.events.at(-1)).toMatchObject({
					keyCode: "1,6",
					captureId: "1,6/1",
					stage: { _tag: "idle", outcome: "cancelled" },
				});
				expect(yield* VoiceSurface.activeFlow("QK")).toEqual(Option.none());
				const stopped = rec.events.length;
				yield* at(1000);
				expect(rec.events).toHaveLength(stopped);
			}).pipe(Effect.provide(stack(rec, MockVoiceRuntimeLive)));
		},
	);
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

for (const reason of [
	"meetingAssistantPrompt.meetingActive",
	"meetingAssistantPrompt.liveTranslateActive",
	"aiAudio.openClawGatewayStarting",
	"aiAudio.prevTurnBusy",
] as const) {
	it.scoped(
		`admission ${reason} blocks grid selection and knob capture before acquisition`,
		() => {
			const rec = recorder();
			let busy = true;
			return Effect.gen(function* () {
				yield* GridVoice.input("QK", input("1,6", "down"));
				yield* at(1400);
				yield* GridVoice.knob("QK", "holdStart", 1);
				expect(rec.calls).toEqual([]);
				expect(rec.tones).toEqual(["busy", "busy"]);
				expect(
					rec.events.filter((e) => e._tag === "Toast").map((e) => e.messageKey),
				).toEqual([reason, reason]);
				busy = false;
				yield* GridVoice.knob("QK", "holdStart", 2);
				expect(rec.calls).toEqual(["start 0,1 #2"]);
				yield* GridVoice.knob("QK", "interrupt", 1);
				expect(rec.calls).toEqual(["start 0,1 #2"]);
			}).pipe(
				Effect.provide(
					stack(rec, fakeRuntime(rec)).pipe(
						Layer.provide(
							Layer.succeed(VoiceAdmission, {
								check: () =>
									Effect.sync(() =>
										busy ? Option.some(reason) : Option.none(),
									),
							}),
						),
					),
				),
			);
		},
	);
}
it.scoped(
	"interrupt disarms a grid reservation and cancels a running chat owner once",
	() => {
		const rec = recorder();
		return Effect.gen(function* () {
			yield* GridVoice.input("QK", input("1,6", "down"));
			yield* GridVoice.knob("QK", "interrupt", 0);
			yield* at(2000);
			expect(rec.calls).toEqual(["select 1,6"]);
			yield* VoiceSurface.reserve("QK", "1,7", "turn/test");
			yield* GridVoice.knob("QK", "interrupt", 1);
			yield* GridVoice.knob("QK", "interrupt", 1);
			expect(rec.calls).toEqual(["select 1,6", "cancelFlow 1,7"]);
		}).pipe(Effect.provide(stack(rec, fakeRuntime(rec))));
	},
);

it.scoped(
	"KNOB-008/064 SCREEN-050: production gateway/foreign-owner gates reject before capture and recover after release",
	() => {
		const rec = recorder();
		return Effect.gen(function* () {
			yield* VoiceSurface.publish({ _tag: "AgentStatus", state: "connecting" });
			yield* GridVoice.input("QK", {
				...input("1,6", "down"),
				type: "clawbot",
			});
			yield* at(1400);
			expect(rec.calls).toEqual([]);
			expect(rec.events.at(-1)).toMatchObject({
				_tag: "Toast",
				messageKey: "aiAudio.openClawGatewayStarting",
			});
			yield* VoiceSurface.publish({ _tag: "AgentStatus", state: "connected" });
			yield* VoiceSurface.reserve("foreign", "1,7", "foreign/1");
			yield* GridVoice.knob("QK", "holdStart", 1);
			expect(rec.calls).toEqual([]);
			expect(rec.events.at(-1)).toMatchObject({
				_tag: "Toast",
				messageKey: "aiAudio.prevTurnBusy",
			});
			yield* VoiceSurface.clearFlow("foreign", "1,7");
			yield* GridVoice.knob("QK", "holdStart", 2);
			expect(rec.calls).toEqual(["start 0,1 #2"]);
		}).pipe(Effect.provide(stack(rec, fakeRuntime(rec))));
	},
);
