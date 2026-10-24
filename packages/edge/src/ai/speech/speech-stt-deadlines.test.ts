import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Either,
	Fiber,
	Layer,
	Option,
	Queue,
	Redacted,
	Schema,
	Stream,
	TestClock,
} from "effect";
import { AiCredentials } from "../ai-credentials.js";
import { AiProviderService } from "../ai-service.js";
import { SpeechHttp, SpeechOutput, SpeechWebSocket } from "./speech-ports.js";
import type { Transcript } from "./speech-stt.js";
import { sttProfile, ttsProfile, wav } from "./speech-test-fixtures.js";

const command = Schema.decodeUnknownSync(
	Schema.parseJson(
		Schema.Struct({
			header: Schema.Struct({ action: Schema.String, task_id: Schema.String }),
		}),
	),
);

describe("recognition phase deadlines include transport sends", () => {
	for (const [stall, phase, deadline] of [
		["run-task", "configure", 10000],
		["pcm", "capture", 60000],
		["finish-task", "final", 15000],
	] as const) {
		it.scoped(`releases capture and playback after a stalled ${stall}`, () =>
			Effect.gen(function* () {
				const stalled = yield* Deferred.make<void>();
				const firstQueue = yield* Deferred.make<Queue.Queue<unknown>>();
				const firstTask = yield* Deferred.make<string>();
				const signals: AbortSignal[] = [];
				const updates: Transcript[] = [];
				let connections = 0;
				let closed = 0;
				let interrupted = 0;
				let played = 0;
				const transport: typeof SpeechWebSocket.Service = {
					connect: (input) =>
						Effect.gen(function* () {
							const messages = yield* Queue.unbounded<unknown>();
							const first = ++connections === 1;
							signals.push(input.signal);
							if (first) yield* Deferred.succeed(firstQueue, messages);
							return {
								receive: Queue.take(messages),
								close: Effect.sync(() => {
									closed++;
								}),
								send: (data: string | Uint8Array) =>
									Effect.gen(function* () {
										const action =
											typeof data === "string"
												? command(data).header.action
												: "pcm";
										if (
											first &&
											typeof data === "string" &&
											action === "run-task"
										)
											yield* Deferred.succeed(
												firstTask,
												command(data).header.task_id,
											);
										if (first && action === stall) {
											yield* Deferred.succeed(stalled, undefined);
											yield* Effect.never.pipe(
												Effect.ensuring(
													Effect.sync(() => {
														interrupted++;
													}),
												),
											);
										}
										if (typeof data === "string" && action === "run-task") {
											yield* Queue.offer(messages, {
												header: {
													task_id: command(data).header.task_id,
													event: "task-started",
												},
											});
										}
									}),
							};
						}),
				};
				yield* Effect.gen(function* () {
					const service = yield* AiProviderService;
					const fiber = yield* service
						.recognize(sttProfile, Stream.make(new Uint8Array(960)), (value) =>
							Effect.sync(() => {
								updates.push(value);
							}),
						)
						.pipe(Effect.either, Effect.forkScoped);
					yield* Deferred.await(stalled);
					yield* TestClock.adjust(deadline - 1);
					expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);
					yield* TestClock.adjust(1);
					expect(Option.isSome(yield* Fiber.poll(fiber))).toBe(true);
					const result = yield* Fiber.join(fiber);
					expect(Either.isLeft(result) && result.left).toMatchObject({
						_tag: "SpeechPhaseTimeout",
						code: "VOICE.CAPTURE.PHASE_TIMEOUT",
						phase,
					});
					expect(closed).toBe(1);
					expect(interrupted).toBe(1);
					expect(signals[0]?.aborted).toBe(true);
					const taskId = yield* Deferred.await(firstTask);
					yield* Queue.offer(yield* Deferred.await(firstQueue), {
						header: { task_id: taskId, event: "result-generated" },
						payload: {
							output: {
								sentence: { text: "late", begin_time: 0, sentence_end: true },
							},
						},
					});
					expect(updates).toEqual([]);
					const speech = yield* service.createSpeech(
						ttsProfile,
						"output works after timeout",
					);
					expect(yield* speech.result).toEqual({ _tag: "completed" });
					expect(played).toBe(1);
					expect(yield* service.recognize(sttProfile, Stream.empty)).toBe("");
					expect(connections).toBe(2);
					expect(closed).toBe(2);
				}).pipe(
					Effect.provide(
						AiProviderService.Default.pipe(
							Layer.provide(
								Layer.mergeAll(
									Layer.succeed(SpeechWebSocket, transport),
									Layer.succeed(AiCredentials, {
										resolve: () => Effect.succeed(Redacted.make("fixture-key")),
										revoked: () => Effect.never,
									}),
									Layer.succeed(SpeechHttp, {
										fetch: async () =>
											new Response(wav(), {
												headers: { "Content-Type": "audio/wav" },
											}),
									}),
									Layer.succeed(SpeechOutput, {
										suspendForCapture: Effect.void,
										acquire: Effect.succeed({
											ready: Effect.void,
											play: () =>
												Effect.sync(() => {
													played++;
												}),
											stop: Effect.void,
										}),
									}),
								),
							),
						),
					),
				);
			}),
		);
	}
	for (const [phase, action, deadline] of [
		["configure", "run-task", 10000],
		["final", "finish-task", 15000],
	] as const) {
		it.scoped(`shares the ${phase} deadline between send and response`, () =>
			Effect.gen(function* () {
				const messages = yield* Queue.unbounded<{
					readonly value: unknown;
					readonly delay: number;
				}>();
				const entered = yield* Deferred.make<void>();
				let closed = false;
				const transport: typeof SpeechWebSocket.Service = {
					connect: () =>
						Effect.succeed({
							receive: Queue.take(messages).pipe(
								Effect.flatMap(({ value, delay }) =>
									Effect.sleep(delay).pipe(Effect.as(value)),
								),
							),
							close: Effect.sync(() => {
								closed = true;
							}),
							send: (data) =>
								Effect.gen(function* () {
									if (typeof data !== "string") return;
									const parsed = command(data);
									const delayed = parsed.header.action === action;
									if (delayed) {
										yield* Deferred.succeed(entered, undefined);
										yield* Effect.sleep(6000);
									}
									yield* Queue.offer(messages, {
										value: {
											header: {
												task_id: parsed.header.task_id,
												event:
													parsed.header.action === "run-task"
														? "task-started"
														: "task-finished",
											},
										},
										delay: delayed ? 10000 : 0,
									});
								}),
						}),
				};
				yield* Effect.gen(function* () {
					const fiber = yield* (yield* AiProviderService)
						.recognize(sttProfile, Stream.make(new Uint8Array(960)))
						.pipe(Effect.either, Effect.forkScoped);
					yield* Deferred.await(entered);
					yield* TestClock.adjust(deadline - 1);
					expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);
					yield* TestClock.adjust(1);
					expect(Option.isSome(yield* Fiber.poll(fiber))).toBe(true);
					const result = yield* Fiber.join(fiber);
					expect(Either.isLeft(result) && result.left).toMatchObject({
						code: "VOICE.CAPTURE.PHASE_TIMEOUT",
						phase,
					});
					expect(closed).toBe(true);
				}).pipe(Effect.provide(recognitionLayer(transport)));
			}),
		);
	}
	it.scoped("keeps the 60-second automatic stop when PCM sends succeed", () =>
		Effect.gen(function* () {
			const messages = yield* Queue.unbounded<unknown>();
			const actions: string[] = [];
			let closed = false;
			const transport: typeof SpeechWebSocket.Service = {
				connect: () =>
					Effect.succeed({
						receive: Queue.take(messages),
						close: Effect.sync(() => {
							closed = true;
						}),
						send: (data) =>
							Effect.gen(function* () {
								if (typeof data !== "string") {
									actions.push("pcm");
									return;
								}
								const parsed = command(data);
								actions.push(parsed.header.action);
								yield* Queue.offer(messages, {
									header: {
										task_id: parsed.header.task_id,
										event:
											parsed.header.action === "run-task"
												? "task-started"
												: "task-finished",
									},
								});
							}),
					}),
			};
			yield* Effect.gen(function* () {
				const fiber = yield* (yield* AiProviderService)
					.recognize(
						sttProfile,
						Stream.make(new Uint8Array(960)).pipe(Stream.concat(Stream.never)),
					)
					.pipe(Effect.either, Effect.forkScoped);
				yield* TestClock.adjust(59999);
				expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);
				yield* TestClock.adjust(1);
				expect(Option.isSome(yield* Fiber.poll(fiber))).toBe(true);
				expect(yield* Fiber.join(fiber)).toEqual(Either.right(""));
				expect(actions).toEqual(["run-task", "pcm", "finish-task"]);
				expect(closed).toBe(true);
			}).pipe(Effect.provide(recognitionLayer(transport)));
		}),
	);
});

function recognitionLayer(transport: typeof SpeechWebSocket.Service) {
	return AiProviderService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(SpeechWebSocket, transport),
				Layer.succeed(AiCredentials, {
					resolve: () => Effect.succeed(Redacted.make("fixture-key")),
					revoked: () => Effect.never,
				}),
			),
		),
	);
}
