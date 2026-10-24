import { Deferred, Effect, Fiber, Schema, Stream } from "effect";
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
			const stopped = yield* Deferred.make<void>();
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
			yield* socket.send(
				JSON.stringify({
					header: { action: "run-task", task_id: taskId, streaming: "duplex" },
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
			);
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
				yield* Deferred.await(ready).pipe(
					Effect.timeoutFail({
						duration: "10 seconds",
						onTimeout: () => new SpeechPhaseTimeout("configure"),
					}),
				);
				let count = 0;
				yield* Stream.runForEach(
					frames.pipe(Stream.interruptAfter("60 seconds")),
					(bytes) => {
						if (!bytes.length || bytes.length > 960 || bytes.length % 2)
							return Effect.fail(new AiProtocolInvalid());
						count++;
						return socket.send(bytes);
					},
				);
				if (!count) {
					yield* Deferred.succeed(result, "");
					return;
				}
				finishing = true;
				yield* socket.send(
					JSON.stringify({
						header: {
							action: "finish-task",
							task_id: taskId,
							streaming: "duplex",
						},
						payload: { input: {} },
					}),
				);
				yield* Deferred.succeed(stopped, undefined);
			});
			const readerFiber = yield* reader.pipe(
				Effect.catchAll((error) => Deferred.fail(result, error)),
				Effect.forkScoped,
			);
			const senderFiber = yield* sender.pipe(
				Effect.catchAll((error) => Deferred.fail(result, error)),
				Effect.forkScoped,
			);
			const final = yield* Effect.raceFirst(
				Deferred.await(result),
				Deferred.await(stopped).pipe(
					Effect.zipRight(Effect.sleep("15 seconds")),
					Effect.zipRight(Effect.fail(new SpeechPhaseTimeout("final"))),
				),
			);
			yield* Fiber.interrupt(readerFiber);
			yield* Fiber.interrupt(senderFiber);
			return final;
		}),
	);
}
