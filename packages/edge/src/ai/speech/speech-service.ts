import {
	Clock,
	Deferred,
	Effect,
	Either,
	Layer,
	Option,
	Redacted,
	Ref,
	Schema,
	type Stream,
} from "effect";
import { AiCredentials } from "../ai-credentials.js";
import {
	AiAuthRequired,
	AiConfigInvalid,
	type AiError,
	AiProtocolInvalid,
	AiUnavailable,
} from "../ai-errors.js";
import {
	type GeneratedAudio,
	OPENAI_TTS_SHUTDOWN,
	OPENAI_VOICES,
	SttProfile,
	TtsProfile,
	validWorkspaceUrl,
} from "./speech-contracts.js";
import { SpeechPhaseTimeout } from "./speech-errors.js";
import { type SynthesisError, synthesizeHttp } from "./speech-http.js";
import { SpeechHttp, SpeechOutput, SpeechWebSocket } from "./speech-ports.js";
import { recognizeSocket, type Transcript } from "./speech-stt.js";
import { playbackWatchdog } from "./speech-watchdog.js";

export type SpeechFailure = SynthesisError | SpeechPhaseTimeout;
export type SpeechOutcome =
	| { readonly _tag: "completed" }
	| { readonly _tag: "cancelled" }
	| { readonly _tag: "textOnly"; readonly error: SpeechFailure };
export interface SpeechTurn {
	readonly result: Effect.Effect<SpeechOutcome>;
	readonly cancel: () => Effect.Effect<void>;
}
export class AiSpeechService extends Effect.Service<AiSpeechService>()(
	"@open-quake/edge/AiSpeechService",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const credentials = yield* Effect.serviceOption(AiCredentials);
			const http = yield* Effect.serviceOption(SpeechHttp);
			const ws = yield* Effect.serviceOption(SpeechWebSocket);
			const output = yield* Effect.serviceOption(SpeechOutput);
			const lease = yield* Effect.makeSemaphore(1);
			const captureActive = yield* Ref.make(false);
			const outputEpoch = yield* Ref.make(yield* Deferred.make<void>());
			const validate = Effect.fn("AiSpeechService.validate")(function* (
				input: unknown,
			): Effect.fn.Return<TtsProfile, AiError> {
				const decoded = Schema.decodeUnknownEither(TtsProfile, {
					onExcessProperty: "error",
				})(input);
				if (Either.isLeft(decoded))
					return yield* new AiConfigInvalid(decoded.left);
				const profile = decoded.right;
				if (profile.provider === "openai") {
					if (
						profile.baseUrl !== "https://api.openai.com/v1" ||
						profile.format !== "wav"
					)
						return yield* new AiConfigInvalid();
					if (
						profile.model !== "gpt-4o-mini-tts" ||
						!OPENAI_VOICES.includes(profile.voice) ||
						(yield* Clock.currentTimeMillis) >= OPENAI_TTS_SHUTDOWN
					)
						return yield* new AiUnavailable();
				} else if (
					!validWorkspaceUrl(profile.baseUrl, "https:") ||
					profile.format !== "pcm" ||
					profile.model !== "qwen-audio-3.1-tts-flash" ||
					profile.voice !== "longanlingxin_v3.1"
				)
					return yield* new AiConfigInvalid();
				return profile;
			});
			const synthesize = Effect.fn("AiSpeechService.synthesize")(function* (
				input: unknown,
				text: string,
				onAudio: () => void = () => {},
			): Effect.fn.Return<GeneratedAudio, SpeechFailure> {
				const profile = yield* validate(input);
				if (!text.trim() || text.length > 4000)
					return yield* new AiConfigInvalid();
				if (Option.isNone(http)) return yield* new AiUnavailable();
				if (Option.isNone(credentials)) return yield* new AiAuthRequired();
				const store = credentials.value;
				return yield* Effect.raceFirst(
					Effect.gen(function* () {
						const key = yield* store.resolve(
							profile.credentialRef,
							profile.authGeneration,
						);
						return yield* synthesizeHttp(
							http.value,
							profile,
							text,
							key,
							onAudio,
						);
					}),
					store.revoked(profile.credentialRef, profile.authGeneration),
				).pipe(
					Effect.timeoutFail({
						duration: "30 seconds",
						onTimeout: () => new SpeechPhaseTimeout("synthesis"),
					}),
				);
			});
			return {
				synthesize,
				recognize: Effect.fn("AiSpeechService.recognize")(function* (
					input: unknown,
					frames: Stream.Stream<Uint8Array, AiError>,
					onTranscript: (value: Transcript) => Effect.Effect<void> = () =>
						Effect.void,
				): Effect.fn.Return<string, AiError | SpeechPhaseTimeout> {
					const decoded = Schema.decodeUnknownEither(SttProfile, {
						onExcessProperty: "error",
					})(input);
					if (
						Either.isLeft(decoded) ||
						!validWorkspaceUrl(decoded.right.baseUrl, "wss:")
					)
						return yield* new AiConfigInvalid();
					if (Option.isNone(ws)) return yield* new AiUnavailable();
					if (Option.isNone(credentials)) return yield* new AiAuthRequired();
					const profile = decoded.right;
					const store = credentials.value;
					return yield* Effect.scoped(
						Effect.gen(function* () {
							yield* Effect.acquireRelease(
								Ref.getAndSet(captureActive, true).pipe(
									Effect.flatMap((active) =>
										active ? Effect.fail(new AiUnavailable()) : Effect.void,
									),
								),
								() => Ref.set(captureActive, false),
							);
							const nextEpoch = yield* Deferred.make<void>();
							const previous = yield* Ref.getAndSet(outputEpoch, nextEpoch);
							yield* Deferred.succeed(previous, undefined);
							if (Option.isSome(output)) {
								if (output.value.capture)
									yield* Effect.acquireRelease(
										output.value.capture,
										(value) => value.stop,
									);
								else yield* output.value.suspendForCapture;
							}
							return yield* lease.withPermits(1)(
								Effect.raceFirst(
									Effect.gen(function* () {
										const key = yield* store.resolve(
											profile.credentialRef,
											profile.authGeneration,
										);
										return yield* recognizeSocket(
											ws.value,
											profile,
											{
												Authorization: `Bearer ${Redacted.value(key)}`,
												"X-DashScope-DataInspection": "enable",
											},
											frames,
											onTranscript,
										);
									}),
									store.revoked(profile.credentialRef, profile.authGeneration),
								),
							);
						}),
					);
				}),
				createSpeech: Effect.fn("AiSpeechService.createSpeech")(function* (
					input: unknown,
					text: string,
					onPhase: (
						phase: "thinking" | "speaking",
					) => Effect.Effect<void> = () => Effect.void,
				): Effect.fn.Return<SpeechTurn> {
					const cancelled = yield* Deferred.make<void>();
					const consumed = yield* Ref.make(false);
					const epoch = yield* Ref.get(outputEpoch);
					const result = Effect.gen(function* (): Effect.fn.Return<
						SpeechOutcome,
						SpeechFailure
					> {
						if (yield* Ref.getAndSet(consumed, true))
							return yield* new AiProtocolInvalid();
						if (yield* Deferred.isDone(cancelled)) return { _tag: "cancelled" };
						if (yield* Ref.get(captureActive)) return { _tag: "cancelled" };
						const profile = yield* validate(input);
						if (Option.isNone(output)) return yield* new AiUnavailable();
						const play = Effect.scoped(
							Effect.gen(function* () {
								yield* onPhase("thinking");
								let hasAudio = false;
								const audio = yield* Effect.raceFirst(
									synthesize(profile, text, () => {
										hasAudio = true;
									}),
									Effect.sleep(12000).pipe(
										Effect.zipRight(
											Effect.suspend(() =>
												hasAudio
													? Effect.never
													: Effect.fail(new SpeechPhaseTimeout("synthesis")),
											),
										),
									),
								);
								let current:
									| Effect.Effect.Success<typeof output.value.acquire>
									| undefined;
								let playbackStarted = false;
								const playback = Effect.gen(function* () {
									const player = yield* Effect.acquireRelease(
										output.value.acquire.pipe(
											Effect.interruptible,
											Effect.timeoutFail({
												duration: "10 seconds",
												onTimeout: () => new SpeechPhaseTimeout("playerReady"),
											}),
										),
										(value) => value.stop,
									);
									current = player;
									yield* player.ready.pipe(
										Effect.timeoutFail({
											duration: "10 seconds",
											onTimeout: () => new SpeechPhaseTimeout("playerReady"),
										}),
									);
									playbackStarted = true;
									yield* onPhase("speaking");
									yield* player.play(audio);
								});
								yield* Effect.raceFirst(
									playback,
									playbackWatchdog(
										audio.durationMs,
										() =>
											current?.contextState?.pipe(
												Effect.orElseSucceed(() => "closed"),
											) ?? Effect.succeed("running"),
										() => current?.resume?.pipe(Effect.ignore) ?? Effect.void,
										() => (playbackStarted ? "playback" : "playerReady"),
									),
								);
								return { _tag: "completed" } satisfies SpeechOutcome;
							}),
						);
						const revoked = Option.isSome(credentials)
							? credentials.value.revoked(
									profile.credentialRef,
									profile.authGeneration,
								)
							: Effect.fail(new AiAuthRequired());
						return yield* Effect.raceFirst(
							lease.withPermits(1)(Effect.raceFirst(play, revoked)),
							Effect.raceFirst(
								Deferred.await(cancelled),
								Deferred.await(epoch),
							).pipe(Effect.as({ _tag: "cancelled" } satisfies SpeechOutcome)),
						);
					}).pipe(
						Effect.catchAll((error) =>
							Effect.succeed({
								_tag: "textOnly",
								error,
							} satisfies SpeechOutcome),
						),
					);
					return {
						result,
						cancel: Effect.fn("AiSpeechService.cancel")(
							(): Effect.Effect<void> =>
								Deferred.succeed(cancelled, undefined).pipe(Effect.asVoid),
						),
					};
				}),
			};
		}),
	},
) {}

/** Explicit opt-in; the default service never performs HTTP. */
export const SpeechFetchLive = Layer.succeed(SpeechHttp, {
	fetch: (url, init) => fetch(url, init),
});
