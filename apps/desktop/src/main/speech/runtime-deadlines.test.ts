import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Layer,
	Option,
	Queue,
	Redacted,
	Schema,
	TestClock,
} from "effect";
import { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import { SpeechWebSocket } from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { AiSpeechService } from "../../../../../packages/edge/src/ai/speech/speech-service";
import { sttProfile } from "../../../../../packages/edge/src/ai/speech/speech-test-fixtures";
import {
	VoiceSurface,
	VoiceSurfacePublisher,
	VoiceTonePort,
} from "../../../../../packages/edge/src/voice/surface";
import type { VoiceSurfaceEvent } from "../../shared/voice-surface";
import type { CaptureDriver } from "./capture";
import { createProductionVoiceRuntime } from "./runtime";

const captureRequest = {
	serial: "fixture",
	keyCode: "1,5",
	captureId: "capture",
	generation: 1,
	type: "aiChat" as const,
	agentId: Option.some("agent"),
};
const command = Schema.decodeUnknownSync(
	Schema.parseJson(
		Schema.Struct({
			header: Schema.Struct({ action: Schema.String, task_id: Schema.String }),
		}),
	),
);
const fixture = Effect.fn("SpeechTest.fixture")(function* (
	mode:
		| "permission"
		| "session"
		| "recorder"
		| "configure"
		| "final"
		| "empty"
		| "auto"
		| "denied",
) {
	const packets = yield* Queue.unbounded<unknown>();
	const published = yield* Queue.unbounded<VoiceSurfaceEvent>();
	const entered = yield* Deferred.make<void>();
	const listening = yield* Deferred.make<void>();
	const stopped = yield* Deferred.make<void>();
	const transcript = yield* Deferred.make<string>();
	let closed = 0,
		socketClosed = 0,
		pulls = 0,
		opened = 0;
	const actions: string[] = [];
	const driver: CaptureDriver = {
		permission:
			mode === "permission"
				? Deferred.succeed(entered, undefined).pipe(
						Effect.zipRight(Effect.never),
					)
				: Effect.succeed(mode !== "denied"),
		open: (id) =>
			Effect.gen(function* () {
				opened++;
				if (mode === "recorder") {
					yield* Deferred.succeed(entered, undefined);
					return yield* Effect.never;
				}
				return {
					pull: Effect.suspend<
						Effect.Effect.Success<import("./capture").CaptureSession["pull"]>,
						never,
						never
					>(() =>
						pulls++ === 0 && mode !== "empty"
							? Effect.succeed({
									frames: [
										{
											captureId: id,
											seq: 0,
											bytes: new Uint8Array(960),
											rms: 0.1,
										},
									],
									done: false,
								})
							: Deferred.await(stopped).pipe(
									Effect.as({ frames: [], done: true }),
								),
					),
					stop: Deferred.succeed(stopped, undefined).pipe(Effect.asVoid),
					close: Effect.sync(() => {
						closed++;
					}),
				};
			}),
	};
	const ws: typeof SpeechWebSocket.Service = {
		connect: () =>
			Effect.succeed({
				receive: Queue.take(packets),
				close: Effect.sync(() => {
					socketClosed++;
				}),
				send: (data) =>
					Effect.gen(function* () {
						if (typeof data !== "string") {
							actions.push("pcm");
							return;
						}
						const value = command(data);
						actions.push(value.header.action);
						if (value.header.action === "run-task") {
							if (mode === "configure") {
								yield* Deferred.succeed(entered, undefined);
								return;
							}
							yield* Queue.offer(packets, {
								header: {
									event: "task-started",
									task_id: value.header.task_id,
								},
							});
						} else if (mode !== "final")
							yield* Queue.offer(packets, {
								header: {
									event: "task-finished",
									task_id: value.header.task_id,
								},
							});
					}),
			}),
	};
	const layer = Layer.mergeAll(
		VoiceSurface.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(VoiceSurfacePublisher, {
						publish: (event) =>
							Queue.offer(published, event).pipe(
								Effect.zipRight(
									event._tag === "Stage" &&
										event.stage._tag === "recording" &&
										event.stage.status === "listening"
										? Deferred.succeed(listening, undefined)
										: Effect.void,
								),
								Effect.asVoid,
							),
					}),
					Layer.succeed(VoiceTonePort, { play: () => Effect.void }),
				),
			),
		),
		AiSpeechService.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(AiCredentials, {
						resolve: () => Effect.succeed(Redacted.make("synthetic")),
						revoked: () => Effect.never,
					}),
					Layer.succeed(SpeechWebSocket, ws),
				),
			),
		),
	);
	return {
		layer,
		driver,
		published,
		entered,
		listening,
		transcript,
		actions,
		counts: () => ({ closed, socketClosed, opened }),
		profiles: () =>
			mode === "session"
				? Deferred.succeed(entered, undefined).pipe(
						Effect.zipRight(Effect.never),
					)
				: Effect.succeed({ stt: sttProfile, speakAnswers: false }),
	};
});
const failed = (
	events: Queue.Queue<VoiceSurfaceEvent>,
): Effect.Effect<Extract<VoiceSurfaceEvent, { _tag: "Stage" }>> =>
	Effect.gen(function* () {
		while (true) {
			const event = yield* Queue.take(events);
			if (event._tag === "Stage" && event.stage._tag === "failed") return event;
		}
	});

describe("production capture deadlines and terminals", () => {
	for (const [mode, ms] of [
		["permission", 30000],
		["session", 10000],
		["configure", 10000],
		["recorder", 10000],
	] as const)
		it.effect(
			`${mode} deadline cleans up and instruments failure before the UI catch`,
			() =>
				Effect.scoped(
					Effect.gen(function* () {
						const f = yield* fixture(mode);
						const diagnostics: string[] = [];
						yield* Effect.gen(function* () {
							const controller = yield* createProductionVoiceRuntime({
								speech: yield* AiSpeechService,
								capture: f.driver,
								profiles: f.profiles,
								sendText: () => Effect.void,
								sendTranscript: () => Effect.die("no transcript allowed"),
								diagnostics: {
									layer: Layer.empty,
									instrument: (effect, operation) =>
										effect.pipe(
											Effect.tapError(() =>
												Effect.sync(() => diagnostics.push(operation)),
											),
										),
								},
							});
							yield* controller.runtime.startCapture(captureRequest);
							yield* Deferred.await(f.entered);
							yield* TestClock.adjust(ms);
							const event = yield* failed(f.published);
							expect(event.stage).toMatchObject({
								_tag: "failed",
								errorCode: "VOICE.CAPTURE.PHASE_TIMEOUT",
							});
							expect(diagnostics).toContain("speech.capture");
							if (mode === "configure" || mode === "recorder")
								expect(f.counts().socketClosed).toBe(1);
							expect(f.actions).not.toContain("pcm");
						}).pipe(Effect.provide(f.layer));
					}),
				),
		);
	it.effect("denied permission never opens a socket or microphone", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const f = yield* fixture("denied");
				yield* Effect.gen(function* () {
					const controller = yield* createProductionVoiceRuntime({
						speech: yield* AiSpeechService,
						capture: f.driver,
						profiles: f.profiles,
						sendText: () => Effect.void,
						sendTranscript: () => Effect.die("must not send"),
					});
					yield* controller.runtime.startCapture(captureRequest);
					expect((yield* failed(f.published)).stage).toMatchObject({
						_tag: "failed",
						reason: "noMic",
						errorCode: "VOICE.CAPTURE.PERMISSION_DENIED",
					});
					expect(f.actions).toEqual([]);
					expect(f.counts().opened).toBe(0);
				}).pipe(Effect.provide(f.layer));
			}),
		),
	);
	it.effect(
		"empty capture closes owned resources without finish-task or chat",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const f = yield* fixture("empty");
					yield* Effect.gen(function* () {
						const controller = yield* createProductionVoiceRuntime({
							speech: yield* AiSpeechService,
							capture: f.driver,
							profiles: f.profiles,
							sendText: () => Effect.void,
							sendTranscript: () => Effect.die("must not send"),
						});
						yield* controller.runtime.startCapture(captureRequest);
						yield* Deferred.await(f.listening);
						yield* controller.runtime.releaseCapture("fixture", "1,5", 1);
						let terminal: VoiceSurfaceEvent;
						do {
							terminal = yield* Queue.take(f.published);
						} while (
							terminal._tag !== "Stage" ||
							terminal.stage._tag !== "idle"
						);
						expect(terminal.stage).toEqual({ _tag: "idle", outcome: "empty" });
						expect(f.actions).toEqual(["run-task"]);
						expect(f.counts()).toEqual({
							opened: 1,
							closed: 1,
							socketClosed: 1,
						});
					}).pipe(Effect.provide(f.layer));
				}),
			),
	);
	it.effect(
		"stop-to-final expires after fifteen seconds and releases microphone and websocket",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const f = yield* fixture("final");
					yield* Effect.gen(function* () {
						const controller = yield* createProductionVoiceRuntime({
							speech: yield* AiSpeechService,
							capture: f.driver,
							profiles: f.profiles,
							sendText: () => Effect.void,
							sendTranscript: () => Effect.die("must not send"),
						});
						yield* controller.runtime.startCapture(captureRequest);
						yield* Deferred.await(f.listening);
						yield* controller.runtime.releaseCapture("fixture", "1,5", 1);
						yield* TestClock.adjust(15000);
						expect((yield* failed(f.published)).stage).toMatchObject({
							_tag: "failed",
							errorCode: "VOICE.CAPTURE.PHASE_TIMEOUT",
						});
						expect(f.counts()).toEqual({
							opened: 1,
							closed: 1,
							socketClosed: 1,
						});
						expect(f.actions).toEqual(["run-task", "pcm", "finish-task"]);
					}).pipe(Effect.provide(f.layer));
				}),
			),
	);
	it.effect(
		"sixty-second automatic stop finalizes nonempty PCM and physically releases capture",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const f = yield* fixture("auto");
					yield* Effect.gen(function* () {
						const controller = yield* createProductionVoiceRuntime({
							speech: yield* AiSpeechService,
							capture: f.driver,
							profiles: f.profiles,
							sendText: () => Effect.void,
							sendTranscript: () =>
								Effect.die("empty transcript must not send"),
						});
						yield* controller.runtime.startCapture(captureRequest);
						yield* Deferred.await(f.listening);
						yield* TestClock.adjust(60000);
						let terminal: VoiceSurfaceEvent;
						do {
							terminal = yield* Queue.take(f.published);
						} while (
							terminal._tag !== "Stage" ||
							terminal.stage._tag !== "idle"
						);
						expect(terminal.stage).toEqual({ _tag: "idle", outcome: "empty" });
						expect(f.counts()).toEqual({
							opened: 1,
							closed: 1,
							socketClosed: 1,
						});
						expect(f.actions).toEqual(["run-task", "pcm", "finish-task"]);
					}).pipe(Effect.provide(f.layer));
				}),
			),
	);
});
