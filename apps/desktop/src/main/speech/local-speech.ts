import { Cause, Clock, Deferred, Effect, Schema } from "effect";
import { AiUnavailable } from "../../../../../packages/edge/src/ai/ai-errors";
import type { SpeechOutputTarget } from "../../../../../packages/edge/src/ai/speech/speech-ports";
import type {
	AiSpeechService,
	SpeechOutcome,
} from "../../../../../packages/edge/src/ai/speech/speech-service";
import type { makeAudioOutput } from "../../../../../packages/edge/src/audio/output-service";
import type { ReaderSettings } from "../../shared/voice-surface";
import { type AudioWorker, openAudioWorker } from "./electron-audio";

/** Local system synthesis uses the same process audio owner as cloud speech. */
export function localSpeech(
	ownership: Effect.Effect.Success<typeof makeAudioOutput>,
	settings: ReaderSettings,
	target: SpeechOutputTarget,
	open = openAudioWorker,
): Pick<AiSpeechService, "createSpeech"> {
	return {
		createSpeech: Effect.fn("DesktopSpeech.localSpeech")(function* (
			_profile,
			text,
			onPhase = () => Effect.void,
		) {
			const cancelled = yield* Deferred.make<void>();
			let consumed = false;
			return {
				cancel: () =>
					Deferred.succeed(cancelled, undefined).pipe(Effect.asVoid),
				result: Effect.suspend(() => {
					if (consumed)
						return Effect.succeed<SpeechOutcome>({
							_tag: "textOnly",
							error: new AiUnavailable(),
						});
					consumed = true;
					const play = Effect.scoped(
						Effect.gen(function* () {
							if (yield* Deferred.isDone(cancelled))
								return { _tag: "cancelled" } as const;
							yield* onPhase("thinking");
							const controller = new AbortController();
							let worker: AudioWorker | undefined;
							let opening: Promise<AudioWorker> | undefined;
							const close = Effect.promise(async () => {
								controller.abort();
								await opening?.catch(() => undefined);
								await worker?.close();
							});
							const reservation = yield* Effect.acquireRelease(
								ownership
									.acquire("speech", close)
									.pipe(Effect.mapError((cause) => new AiUnavailable(cause))),
								(lease) => lease.release,
							);
							yield* Effect.tryPromise({
								try: () => {
									opening = open(controller.signal, target).then((value) => {
										worker = value;
										return value;
									});
									return opening;
								},
								catch: (cause) => new AiUnavailable(cause),
							});
							if (!(yield* reservation.current))
								return yield* new AiUnavailable();
							const boundary = (method: string, args?: readonly unknown[]) =>
								Effect.tryPromise({
									try: () =>
										worker
											? worker.invoke(method, args)
											: Promise.reject(new AiUnavailable()),
									catch: (cause) => new AiUnavailable(cause),
								});
							yield* boundary("speakLocal", [text, settings]);
							let started = false;
							const queuedAt = yield* Clock.currentTimeMillis;
							yield* Effect.gen(function* () {
								while (true) {
									const state = yield* boundary("localState").pipe(
										Effect.flatMap(
											Schema.decodeUnknown(
												Schema.Struct({
													started: Schema.Boolean,
													done: Schema.Boolean,
													failed: Schema.Boolean,
												}),
											),
										),
										Effect.mapError((cause) => new AiUnavailable(cause)),
									);
									if (state.failed) return yield* new AiUnavailable();
									if (state.started && !started) {
										started = true;
										yield* onPhase("speaking");
									}
									if (state.done) return;
									if (
										!started &&
										(yield* Clock.currentTimeMillis) - queuedAt >= 12000
									)
										return yield* new AiUnavailable();
									yield* Effect.sleep("25 millis");
								}
							}).pipe(
								Effect.timeoutFail({
									duration: "120 seconds",
									onTimeout: () => new AiUnavailable(),
								}),
							);
							return { _tag: "completed" } as const;
						}),
					);
					return Effect.raceFirst(
						play,
						Deferred.await(cancelled).pipe(
							Effect.as({ _tag: "cancelled" } as const),
						),
					).pipe(
						Effect.catchAll((error) =>
							Effect.succeed({ _tag: "textOnly", error } as const),
						),
						Effect.catchAllCause((cause) =>
							Cause.isInterruptedOnly(cause)
								? Effect.succeed({ _tag: "cancelled" } as const)
								: Effect.failCause(cause),
						),
					);
				}),
			};
		}),
	};
}
