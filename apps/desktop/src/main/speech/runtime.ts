import { Effect, Fiber, Option, Scope } from "effect";
import {
	type AiError,
	AiUnavailable,
} from "../../../../../packages/edge/src/ai/ai-errors";
import type {
	SttProfile,
	TtsProfile,
} from "../../../../../packages/edge/src/ai/speech/speech-contracts";
import type {
	AiSpeechService,
	SpeechOutcome,
} from "../../../../../packages/edge/src/ai/speech/speech-service";
import {
	GridVoiceRuntime,
	VoiceRuntimeUnavailable,
	VoiceSurface,
} from "../../../../../packages/edge/src/voice/surface";
import type {
	CaptureRequest,
	TextRequest,
} from "../../../../../packages/edge/src/voice/surface/voice-surface-ports";
import type { VoiceStage, VoiceSurfaceEvent } from "../../shared/voice-surface";
import {
	type CaptureDriver,
	type CaptureSession,
	captureFrames,
} from "./capture";
import { instrumentSpeechOutcome, type SpeechDiagnostics } from "./diagnostics";
import { DesktopSpeechError } from "./errors";
import { createOrderedSpeech, type OrderedSpeech } from "./ordered";

export interface SpeechProfiles {
	readonly stt?: SttProfile;
	readonly tts?: TtsProfile;
	readonly speakAnswers: boolean;
}
export interface ProductionVoiceOptions {
	readonly speech: AiSpeechService;
	readonly capture: CaptureDriver;
	readonly profiles: () => Effect.Effect<SpeechProfiles, AiError>;
	readonly sendTranscript: (
		request: TextRequest,
	) => Effect.Effect<void, VoiceRuntimeUnavailable>;
	readonly sendText: (
		request: TextRequest,
	) => Effect.Effect<void, VoiceRuntimeUnavailable>;
	readonly cancelText?: (
		serial: string,
		keyCode: string,
	) => Effect.Effect<void>;
	readonly diagnostics?: SpeechDiagnostics;
	/** UI notification keeps chat text intact on speech-only errors. */
	readonly speechError?: (code: string) => Effect.Effect<void>;
}
export const createProductionVoiceRuntime = Effect.fn(
	"DesktopSpeech.createRuntime",
)(function* (options: ProductionVoiceOptions) {
	const surface = yield* VoiceSurface;
	const scope = yield* Effect.scope;
	const lock = yield* Effect.makeSemaphore(1);
	const eventLock = yield* Effect.makeSemaphore(1);
	const report = (error: { readonly code: string }) =>
		options.speechError?.(error.code) ?? Effect.void;
	const instrument = <A, E, R>(
		effect: Effect.Effect<A, E, R>,
		operation: "speech.capture" | "speech.recognize" | "speech.playback",
	) => options.diagnostics?.instrument(effect, operation) ?? effect;
	type Active = {
		readonly request: CaptureRequest;
		readonly fiber: Fiber.RuntimeFiber<void>;
		session?: CaptureSession;
		released: boolean;
		terminal: boolean;
		listening: boolean;
	};
	let active: Active | undefined;
	let closed = false;
	let readAloud: Fiber.RuntimeFiber<SpeechOutcome> | undefined;
	let cancelReadAloud: (() => Effect.Effect<void>) | undefined;
	const turns = new Map<
		string,
		{ readonly id: string; readonly speech: OrderedSpeech; seq: number }
	>();
	const stage = (owner: Active, value: VoiceStage) =>
		active === owner && !owner.terminal
			? surface.publish({
					_tag: "Stage",
					serial: owner.request.serial,
					keyCode: owner.request.keyCode,
					captureId: owner.request.captureId,
					stage: value,
				})
			: Effect.void;
	const cancelSpeech = Effect.fn("DesktopSpeech.cancelSpeech")(function* () {
		for (const turn of turns.values()) yield* turn.speech.cancel();
		turns.clear();
		if (readAloud) {
			if (cancelReadAloud) yield* cancelReadAloud();
			yield* Fiber.await(readAloud);
			readAloud = undefined;
		}
	});
	const stop = Effect.fn("DesktopSpeech.stopCapture")(function* () {
		const owner = active;
		if (!owner) return;
		owner.released = true;
		yield* Fiber.interrupt(owner.fiber);
		if (active === owner) active = undefined;
	});
	yield* Effect.addFinalizer(() =>
		Effect.gen(function* () {
			closed = true;
			yield* stop();
			yield* cancelSpeech();
		}),
	);
	const runtime = GridVoiceRuntime.of({
		select: (serial, keyCode) =>
			Effect.gen(function* () {
				if (
					active &&
					(active.request.serial !== serial ||
						active.request.keyCode !== keyCode)
				)
					yield* stop();
				yield* cancelSpeech();
			}),
		startCapture: (request) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					if (closed) return yield* new VoiceRuntimeUnavailable();
					yield* stop();
					yield* cancelSpeech();
					const start = yield* Effect.makeLatch();
					let owner: Active;
					const body = Effect.gen(function* () {
						yield* stage(owner, { _tag: "recording", status: "preparing" });
						const profiles = yield* options.profiles().pipe(
							Effect.timeoutFail({
								duration: "10 seconds",
								onTimeout: () =>
									new DesktopSpeechError("PhaseTimeout", "session"),
							}),
						);
						if (!profiles.stt) return yield* new AiUnavailable();
						const allowed = yield* options.capture.permission.pipe(
							Effect.timeoutFail({
								duration: "30 seconds",
								onTimeout: () =>
									new DesktopSpeechError("PhaseTimeout", "permission"),
							}),
						);
						if (!allowed)
							return yield* new DesktopSpeechError(
								"PermissionDenied",
								"permission",
							);
						if (owner.released || active !== owner) return;
						const frames = captureFrames(
							options.capture,
							request.captureId,
							(session) =>
								Effect.gen(function* () {
									owner.session = session;
									if (owner.released || active !== owner) {
										yield* session.close;
										return;
									}
									owner.listening = true;
									yield* stage(owner, {
										_tag: "recording",
										status: "listening",
									});
								}),
							(frame) =>
								active === owner && !owner.released
									? surface.publish({
											_tag: "Level",
											serial: request.serial,
											keyCode: request.keyCode,
											captureId: request.captureId,
											rms: frame.rms,
											speaking: frame.rms > 0.02,
										})
									: Effect.void,
						);
						const transcript = yield* instrument(
							options.speech.recognize(profiles.stt, frames, (value) =>
								value.final
									? Effect.void
									: stage(
											owner,
											owner.released
												? {
														_tag: "processing",
														transcript: value.text.slice(0, 8000),
													}
												: {
														_tag: "recording",
														status: "listening",
														transcript: value.text.slice(0, 8000),
													},
										),
							),
							"speech.recognize",
						);
						if (active !== owner) return;
						if (!transcript.trim()) {
							yield* stage(owner, { _tag: "idle", outcome: "empty" });
							owner.terminal = true;
							return;
						}
						yield* stage(owner, {
							_tag: "processing",
							transcript: transcript.slice(0, 8000),
						});
						// Capture is finalized and mic/socket are physically released before chat.
						yield* stage(owner, { _tag: "idle", outcome: "completed" });
						yield* options.sendTranscript({
							serial: request.serial,
							keyCode: request.keyCode,
							agentId: Option.getOrElse(request.agentId, () => ""),
							message: transcript.slice(0, 8000),
						});
						owner.terminal = true;
					});
					const fiber = yield* start.await.pipe(
						Effect.zipRight(instrument(body, "speech.capture")),
						Effect.catchAll((error) => {
							const failure =
								error instanceof AiUnavailable &&
								error.originalCause instanceof DesktopSpeechError
									? error.originalCause
									: error;
							return stage(owner, {
								_tag: "failed",
								reason:
									failure instanceof DesktopSpeechError &&
									(failure.code === "VOICE.CAPTURE.PERMISSION_DENIED" ||
										failure.code === "VOICE.CAPTURE.RECORDER_UNAVAILABLE")
										? "noMic"
										: "server",
								errorCode: failure.code,
							});
						}),
						Effect.onInterrupt(() =>
							stage(owner, { _tag: "idle", outcome: "cancelled" }),
						),
						Effect.ensuring(
							Effect.sync(() => {
								owner.terminal = true;
								if (active === owner) active = undefined;
							}),
						),
						Effect.forkIn(scope),
					);
					owner = {
						request,
						fiber,
						released: false,
						terminal: false,
						listening: false,
					};
					active = owner;
					yield* start.open;
				}),
			),
		releaseCapture: (serial, keyCode, generation) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					const owner = active;
					if (
						!owner ||
						owner.request.serial !== serial ||
						owner.request.keyCode !== keyCode ||
						owner.request.generation !== generation ||
						owner.released
					)
						return;
					owner.released = true;
					if (!owner.listening || !owner.session) {
						yield* stop();
						return;
					}
					yield* owner.session.stop;
					yield* stage(owner, { _tag: "processing" });
				}),
			),
		cancelCapture: (serial, keyCode, generation) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					if (
						active?.request.serial === serial &&
						active.request.keyCode === keyCode &&
						active.request.generation === generation
					)
						yield* stop();
				}),
			),
		cancelFlow: (serial, keyCode) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					if (
						active?.request.serial === serial &&
						active.request.keyCode === keyCode
					)
						yield* stop();
					yield* cancelSpeech();
					yield* options.cancelText?.(serial, keyCode) ?? Effect.void;
				}),
			),
		sendText: (request) => options.sendText(request),
	});
	return {
		runtime,
		cancelSpeech,
		reset: Effect.fn("DesktopSpeech.reset")(function* () {
			yield* lock.withPermits(1)(stop());
			yield* cancelSpeech();
		}),
		readAloud: Effect.fn("DesktopSpeech.readAloud")(function* (
			text: string,
		): Effect.fn.Return<SpeechOutcome> {
			yield* cancelSpeech();
			const profile = yield* options.profiles().pipe(Effect.either);
			if (profile._tag === "Left" || !profile.right.tts)
				return {
					_tag: "textOnly",
					error: profile._tag === "Left" ? profile.left : new AiUnavailable(),
				};
			if (closed || active) return { _tag: "cancelled" };
			const turn = yield* options.speech.createSpeech(profile.right.tts, text);
			const fiber = yield* instrumentSpeechOutcome(
				turn.result,
				options.diagnostics?.instrument,
			).pipe(Effect.forkIn(scope));
			readAloud = fiber;
			cancelReadAloud = turn.cancel;
			return yield* Fiber.join(fiber).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						if (readAloud === fiber) {
							readAloud = undefined;
							cancelReadAloud = undefined;
						}
					}),
				),
			);
		}),
		observe: Effect.fn("DesktopSpeech.observe")(
			(event: VoiceSurfaceEvent): Effect.Effect<void> =>
				eventLock.withPermits(1)(
					Effect.gen(function* () {
						if (closed) return;
						if (event._tag === "Reset") {
							yield* cancelSpeech();
							return;
						}
						if (event._tag === "TurnStarted") {
							const old = turns.get(event.serial);
							if (old) yield* old.speech.cancel();
							turns.delete(event.serial);
							const profiles = yield* options.profiles().pipe(Effect.either);
							if (
								profiles._tag === "Left" ||
								!profiles.right.speakAnswers ||
								!profiles.right.tts
							)
								return;
							const speech = yield* createOrderedSpeech({
								speech: options.speech,
								profile: profiles.right.tts,
								report,
								instrument: options.diagnostics?.instrument,
							}).pipe(Effect.provideService(Scope.Scope, scope));
							if (turns.size >= 16) {
								const oldest = turns.keys().next().value;
								if (oldest !== undefined) {
									yield* turns.get(oldest)?.speech.cancel() ?? Effect.void;
									turns.delete(oldest);
								}
							}
							turns.set(event.serial, { id: event.turnId, speech, seq: -1 });
							return;
						}
						if (event._tag !== "Chunk") return;
						const turn = turns.get(event.serial);
						if (
							!turn ||
							turn.id !== event.chunk.turnId ||
							event.chunk.seq <= turn.seq
						)
							return;
						turn.seq = event.chunk.seq;
						if (event.chunk.type === "answer")
							yield* turn.speech.push(event.chunk.textDelta);
						else if (event.chunk.type === "end")
							yield* turn.speech.finish(
								event.chunk.outcome === "timedOut"
									? "failed"
									: event.chunk.outcome,
							);
					}),
				),
		),
	};
});
