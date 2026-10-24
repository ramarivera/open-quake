import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Either,
	Fiber,
	Layer,
	Queue,
	Redacted,
	Schema,
	Stream,
	TestClock,
} from "effect";
import { AiCredentials } from "../ai-credentials.js";
import { AiProtocolInvalid } from "../ai-errors.js";
import { AiProviderService } from "../ai-service.js";
import { SpeechOutput, SpeechWebSocket } from "./speech-ports.js";
import type { Transcript } from "./speech-stt.js";
import { sttProfile } from "./speech-test-fixtures.js";

const Command = Schema.parseJson(
	Schema.Struct({
		header: Schema.Struct({ action: Schema.String, task_id: Schema.String }),
		payload: Schema.Unknown,
	}),
);
const decodeCommand = Schema.decodeUnknownSync(Command);
const frame = (taskId: string, event: string, payload: unknown = {}) => ({
	header: { task_id: taskId, event },
	payload,
});
const sentence = (text: string, sentence_end: boolean) => ({
	output: { sentence: { text, begin_time: 0, sentence_end } },
});

describe("DashScope recognition through the facade", () => {
	it.effect(
		"gates PCM on matching readiness, replaces partials, deduplicates finals and finishes once",
		() =>
			Effect.gen(function* () {
				const messages = yield* Queue.unbounded<unknown>();
				const run = yield* Deferred.make<string>();
				const sent: (string | Uint8Array)[] = [];
				const updates: Transcript[] = [];
				let closed = 0;
				const transport: typeof SpeechWebSocket.Service = {
					connect: (input) =>
						Effect.sync(() => {
							expect(input.url).toBe(
								"wss://fixture.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
							);
							expect(input.headers.Authorization).toBe("Bearer fixture-key");
							return {
								receive: Queue.take(messages),
								close: Effect.sync(() => {
									closed++;
								}),
								send: (data: string | Uint8Array) =>
									Effect.gen(function* () {
										sent.push(data);
										if (typeof data !== "string") return;
										const command = decodeCommand(data);
										if (command.header.action === "run-task") {
											expect(command.payload).toMatchObject({
												model: "qwen-audio-3.1-asr-flash-streaming",
												parameters: { format: "pcm", sample_rate: 24000 },
											});
											yield* Deferred.succeed(run, command.header.task_id);
										} else {
											yield* Queue.offerAll(messages, [
												frame(
													command.header.task_id,
													"result-generated",
													sentence("turn", false),
												),
												frame(
													command.header.task_id,
													"result-generated",
													sentence("turn left", false),
												),
												frame(
													command.header.task_id,
													"result-generated",
													sentence("turn left", true),
												),
												frame(
													command.header.task_id,
													"result-generated",
													sentence("turn left", true),
												),
												frame(command.header.task_id, "task-finished"),
											]);
										}
									}),
							};
						}),
				};
				yield* Effect.gen(function* () {
					const fiber = yield* (yield* AiProviderService)
						.recognize(sttProfile, Stream.make(new Uint8Array(960)), (update) =>
							Effect.sync(() => {
								updates.push(update);
							}),
						)
						.pipe(Effect.fork);
					const taskId = yield* Deferred.await(run);
					yield* TestClock.adjust(9000);
					expect(sent.filter((v) => v instanceof Uint8Array)).toEqual([]);
					yield* Queue.offer(messages, frame(taskId, "task-started"));
					expect(yield* Fiber.join(fiber)).toBe("turn left");
					expect(sent.filter((v) => v instanceof Uint8Array)).toHaveLength(1);
					expect(
						sent
							.filter((v) => typeof v === "string")
							.map(
								(v) => typeof v === "string" && decodeCommand(v).header.action,
							),
					).toEqual(["run-task", "finish-task"]);
					expect(updates.map((v) => v.text)).toEqual([
						"turn",
						"turn left",
						"turn left",
						"turn left",
					]);
					expect(updates.at(-1)?.final).toBe(true);
					expect(closed).toBe(1);
				}).pipe(Effect.provide(sttLayer(transport)));
			}),
	);
	it.effect("empty capture never commits PCM or finish-task", () =>
		Effect.gen(function* () {
			const messages = yield* Queue.unbounded<unknown>();
			const actions: string[] = [];
			const transport: typeof SpeechWebSocket.Service = {
				connect: () =>
					Effect.succeed({
						receive: Queue.take(messages),
						close: Effect.void,
						send: (data) =>
							Effect.gen(function* () {
								if (typeof data !== "string")
									return yield* new AiProtocolInvalid();
								const command = decodeCommand(data);
								actions.push(command.header.action);
								yield* Queue.offer(
									messages,
									frame(command.header.task_id, "task-started"),
								);
							}),
					}),
			};
			yield* Effect.gen(function* () {
				expect(
					yield* (yield* AiProviderService).recognize(sttProfile, Stream.empty),
				).toBe("");
				expect(actions).toEqual(["run-task"]);
			}).pipe(Effect.provide(sttLayer(transport)));
		}),
	);
	it.effect(
		"rejects malformed frames, wrong task IDs, provider failure and premature close",
		() =>
			Effect.gen(function* () {
				for (const fault of [
					"malformed",
					"wrong-task",
					"task-failed",
					"close",
				] as const) {
					const messages = yield* Queue.unbounded<unknown>();
					let closed = 0;
					const transport: typeof SpeechWebSocket.Service = {
						connect: () =>
							Effect.succeed({
								receive:
									fault === "close"
										? Effect.fail(new AiProtocolInvalid())
										: Queue.take(messages),
								close: Effect.sync(() => {
									closed++;
								}),
								send: (data) =>
									Effect.gen(function* () {
										if (typeof data === "string") {
											const command = decodeCommand(data);
											yield* Queue.offer(
												messages,
												fault === "malformed"
													? "not JSON"
													: frame(
															fault === "wrong-task"
																? "old-task"
																: command.header.task_id,
															fault === "task-failed"
																? "task-failed"
																: "task-started",
														),
											);
										}
									}),
							}),
					};
					yield* Effect.gen(function* () {
						const result = yield* Effect.either(
							(yield* AiProviderService).recognize(
								sttProfile,
								Stream.make(new Uint8Array(960)),
							),
						);
						expect(Either.isLeft(result) && result.left.code).toBe(
							"AI.PROVIDER.PROTOCOL_INVALID",
						);
						expect(closed).toBe(1);
					}).pipe(Effect.provide(sttLayer(transport)));
				}
			}),
	);
	it.effect("times out missing readiness and closes before late events", () =>
		Effect.gen(function* () {
			let signal: AbortSignal | undefined;
			let closed = 0;
			let sends = 0;
			const transport: typeof SpeechWebSocket.Service = {
				connect: (input) =>
					Effect.sync(() => {
						signal = input.signal;
						return {
							receive: Effect.never,
							close: Effect.sync(() => {
								closed++;
							}),
							send: () =>
								Effect.sync(() => {
									sends++;
								}),
						};
					}),
			};
			yield* Effect.gen(function* () {
				const fiber = yield* (yield* AiProviderService)
					.recognize(sttProfile, Stream.make(new Uint8Array(960)))
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(10000);
				const result = yield* Fiber.join(fiber);
				expect(
					Either.isLeft(result) && "phase" in result.left && result.left.phase,
				).toBe("configure");
				expect(closed).toBe(1);
				expect(sends).toBe(1);
				expect(signal?.aborted).toBe(true);
			}).pipe(Effect.provide(sttLayer(transport)));
		}),
	);
	it.effect(
		"cancels before readiness and never delivers a late transcript",
		() =>
			Effect.gen(function* () {
				const messages = yield* Queue.unbounded<unknown>();
				const run = yield* Deferred.make<string>();
				let closed = 0;
				let binary = 0;
				const transcripts: Transcript[] = [];
				const transport: typeof SpeechWebSocket.Service = {
					connect: () =>
						Effect.succeed({
							receive: Queue.take(messages),
							close: Effect.sync(() => {
								closed++;
							}),
							send: (data) =>
								typeof data === "string"
									? Deferred.succeed(
											run,
											decodeCommand(data).header.task_id,
										).pipe(Effect.asVoid)
									: Effect.sync(() => {
											binary++;
										}),
						}),
				};
				yield* Effect.gen(function* () {
					const fiber = yield* (yield* AiProviderService)
						.recognize(sttProfile, Stream.make(new Uint8Array(960)), (value) =>
							Effect.sync(() => {
								transcripts.push(value);
							}),
						)
						.pipe(Effect.fork);
					const id = yield* Deferred.await(run);
					yield* Fiber.interrupt(fiber);
					yield* Queue.offerAll(messages, [
						frame(id, "task-started"),
						frame(id, "result-generated", sentence("late", true)),
						frame(id, "task-finished"),
					]);
					expect(closed).toBe(1);
					expect(binary).toBe(0);
					expect(transcripts).toEqual([]);
				}).pipe(Effect.provide(sttLayer(transport)));
			}),
	);
	it.effect("bounds connection and final response waits", () =>
		Effect.gen(function* () {
			for (const phase of ["connect", "final"] as const) {
				const queue = yield* Queue.unbounded<unknown>();
				let aborted: AbortSignal | undefined;
				let closed = 0;
				const transport: typeof SpeechWebSocket.Service = {
					connect: (input) => {
						aborted = input.signal;
						return phase === "connect"
							? Effect.never
							: Effect.succeed({
									receive: Queue.take(queue),
									close: Effect.sync(() => {
										closed++;
									}),
									send: (data) =>
										Effect.gen(function* () {
											if (typeof data === "string") {
												const c = decodeCommand(data);
												if (c.header.action === "run-task")
													yield* Queue.offer(
														queue,
														frame(c.header.task_id, "task-started"),
													);
											}
										}),
								});
					},
				};
				yield* Effect.gen(function* () {
					const fiber = yield* (yield* AiProviderService)
						.recognize(sttProfile, Stream.make(new Uint8Array(960)))
						.pipe(Effect.either, Effect.fork);
					yield* TestClock.adjust(phase === "connect" ? 10000 : 15000);
					const result = yield* Fiber.join(fiber);
					expect(
						Either.isLeft(result) &&
							"phase" in result.left &&
							result.left.phase,
					).toBe(phase);
					expect(aborted?.aborted).toBe(true);
					expect(closed).toBe(phase === "connect" ? 0 : 1);
				}).pipe(Effect.provide(sttLayer(transport)));
			}
		}),
	);
	it.effect(
		"suspends host output before recognition and never resumes it",
		() =>
			Effect.gen(function* () {
				let suspended = false;
				let opens = 0;
				const transport: typeof SpeechWebSocket.Service = {
					connect: () =>
						Effect.sync(() => {
							expect(suspended).toBe(true);
							opens++;
							return {
								send: () => Effect.void,
								receive: Effect.fail(new AiProtocolInvalid()),
								close: Effect.void,
							};
						}),
				};
				yield* Effect.gen(function* () {
					yield* Effect.either(
						(yield* AiProviderService).recognize(sttProfile, Stream.empty),
					);
					expect(opens).toBe(1);
					expect(suspended).toBe(true);
				}).pipe(
					Effect.provide(
						sttLayer(transport).pipe(
							Layer.provide(
								Layer.succeed(SpeechOutput, {
									suspendForCapture: Effect.sync(() => {
										suspended = true;
									}),
									acquire: Effect.die("no playback during capture"),
								}),
							),
						),
					),
				);
			}),
	);
});
function sttLayer(transport: typeof SpeechWebSocket.Service) {
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
