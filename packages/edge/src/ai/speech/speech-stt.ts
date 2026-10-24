import { Clock, Deferred, Effect, Fiber, Schema, Stream } from "effect";
import { type AiError, AiProtocolInvalid } from "../ai-errors.js";
import type { SttProfile } from "./speech-contracts.js";
import { SpeechPhaseTimeout } from "./speech-errors.js";
import type { SpeechWebSocket } from "./speech-ports.js";

const Event = Schema.Struct({
	header: Schema.Struct({
		event: Schema.Literal(
			"task-started",
			"result-generated",
			"task-finished",
			"task-failed",
		),
		task_id: Schema.String,
	}),
	payload: Schema.optional(
		Schema.Struct({
			output: Schema.optional(
				Schema.Struct({
					sentence: Schema.Struct({
						text: Schema.String,
						begin_time: Schema.Int.pipe(Schema.nonNegative()),
						sentence_end: Schema.Boolean,
					}),
				}),
			),
		}),
	),
});
const decode = (input: unknown) =>
	typeof input === "string"
		? Schema.decodeUnknown(Schema.parseJson(Event))(input)
		: Schema.decodeUnknown(Event)(input);
export interface Transcript {
	readonly text: string;
	readonly final: boolean;
}
export function recognizeSocket(
	transport: typeof SpeechWebSocket.Service,
	profile: SttProfile,
	headers: Readonly<Record<string, string>>,
	frames: Stream.Stream<Uint8Array, AiError>,
	onTranscript: (value: Transcript) => Effect.Effect<void>,
): Effect.Effect<string, AiError | SpeechPhaseTimeout> {
	return Effect.scoped(
		Effect.gen(function* () {
			const controller = new AbortController();
			yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
			const socket = yield* Effect.acquireRelease(
				transport
					.connect({
						url: `${profile.baseUrl.replace(/\/$/, "")}/api-ws/v1/inference`,
						headers,
						signal: controller.signal,
					})
					.pipe(
						Effect.interruptible,
						Effect.timeoutFail({
							duration: "10 seconds",
							onTimeout: () => new SpeechPhaseTimeout("connect"),
						}),
					),
				(socket) => socket.close,
			);
			const taskId = crypto.randomUUID().replaceAll("-", "");
			const ready = yield* Deferred.make<void, AiError>();
			const result = yield* Deferred.make<
				string,
				AiError | SpeechPhaseTimeout
			>();
			let finishing = false;
			let started = false;
			let current = "";
			const segments = new Map<number, string>();
			const transcript = () =>
				[...segments.entries()]
					.sort(([a], [b]) => a - b)
					.map(([, value]) => value)
					.join("");
			const reader = Effect.gen(function* () {
				while (true) {
					const event = yield* socket.receive.pipe(
						Effect.flatMap((input) =>
							decode(input).pipe(
								Effect.mapError((cause) => new AiProtocolInvalid(cause)),
							),
						),
					);
					if (event.header.task_id !== taskId)
						return yield* new AiProtocolInvalid();
					switch (event.header.event) {
						case "task-failed":
							return yield* new AiProtocolInvalid(event);
						case "task-started":
							if (started) return yield* new AiProtocolInvalid();
							started = true;
							yield* Deferred.succeed(ready, undefined);
							break;
						case "result-generated": {
							const sentence = event.payload?.output?.sentence;
							if (!started || !sentence || sentence.text.length > 64000)
								return yield* new AiProtocolInvalid();
							if (segments.has(sentence.begin_time)) break;
							if (sentence.sentence_end) {
								segments.set(sentence.begin_time, sentence.text);
								current = "";
							} else current = sentence.text;
							if (
								segments.size > 3000 ||
								transcript().length + current.length > 64000
							)
								return yield* new AiProtocolInvalid();
							yield* onTranscript({
								text: transcript() + current,
								final: false,
							});
							break;
						}
						case "task-finished":
							if (!started || !finishing || current !== "")
								return yield* new AiProtocolInvalid();
							yield* onTranscript({ text: transcript(), final: true });
							yield* Deferred.succeed(result, transcript());
							return;
					}
				}
			});
			const sender = Effect.gen(function* () {
				yield* socket
					.send(
						JSON.stringify({
							header: {
								action: "run-task",
								task_id: taskId,
								streaming: "duplex",
							},
							payload: {
								task_group: "audio",
								task: "asr",
								function: "recognition",
								model: profile.model,
								parameters: {
									format: "pcm",
									sample_rate: 24000,
									punctuation_prediction_enabled: true,
								},
								input: {},
							},
						}),
					)
					.pipe(
						Effect.zipRight(Deferred.await(ready)),
						Effect.timeoutFail({
							duration: "10 seconds",
							onTimeout: () => new SpeechPhaseTimeout("configure"),
						}),
					);
				let count = 0;
				const captureDeadline = (yield* Clock.currentTimeMillis) + 60000;
				yield* Stream.runForEach(
					frames.pipe(Stream.interruptAfter("60 seconds")),
					(bytes) =>
						Effect.gen(function* () {
							if (!bytes.length || bytes.length > 960 || bytes.length % 2)
								return yield* new AiProtocolInvalid();
							count++;
							const remaining =
								captureDeadline - (yield* Clock.currentTimeMillis);
							return yield* socket.send(bytes).pipe(
								Effect.timeoutFail({
									duration: Math.max(0, remaining),
									onTimeout: () => new SpeechPhaseTimeout("capture"),
								}),
							);
						}),
				);
				if (!count) return "";
				finishing = true;
				return yield* socket
					.send(
						JSON.stringify({
							header: {
								action: "finish-task",
								task_id: taskId,
								streaming: "duplex",
							},
							payload: { input: {} },
						}),
					)
					.pipe(
						Effect.zipRight(Deferred.await(result)),
						Effect.timeoutFail({
							duration: "15 seconds",
							onTimeout: () => new SpeechPhaseTimeout("final"),
						}),
					);
			});
			const readerFiber = yield* reader.pipe(
				Effect.catchAll((error) => Deferred.fail(result, error)),
				Effect.forkScoped,
			);
			const final = yield* Effect.raceFirst(
				sender,
				// Reader failures interrupt a blocked send. Success still waits for
				// finish-task to complete within the same final-phase deadline.
				Deferred.await(result).pipe(Effect.zipRight(Effect.never)),
			);
			yield* Fiber.interrupt(readerFiber);
			return final;
		}),
	);
}
