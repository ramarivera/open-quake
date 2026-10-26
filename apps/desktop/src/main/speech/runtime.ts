import { Cause, Clock, Effect, Exit, Fiber, Option, Scope } from "effect";
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
import { VoiceKnobRejected } from "../../../../../packages/edge/src/voice/surface/voice-surface-errors";
import {
	initialVoiceActivity,
	isKnobVoiceKey,
	meterLevel,
	shouldEmitLevel,
	stepVoiceActivity,
} from "../../../../../packages/edge/src/voice/surface/voice-surface-invariants";
import type {
	CaptureRequest,
	KnobCaptureSnapshot,
	PinnedDirectModel,
	TextRequest,
} from "../../../../../packages/edge/src/voice/surface/voice-surface-ports";
import type {
	ReaderSettings,
	VoiceStage,
	VoiceSurfaceEvent,
} from "../../shared/voice-surface";
import {
	type CaptureDriver,
	type CaptureSession,
	captureFrames,
} from "./capture";
import { type CaptureMetrics, createCaptureMetrics } from "./capture-metrics";
import { instrumentSpeechOutcome, type SpeechDiagnostics } from "./diagnostics";
import { DesktopSpeechError } from "./errors";
import { createOrderedSpeech, type OrderedSpeech } from "./ordered";
import { spokenStatus } from "./status-phrases";

export interface SpeechProfiles {
	readonly stt?: SttProfile;
	readonly tts?: TtsProfile;
	readonly speakAnswers: boolean;
}
export interface ProductionVoiceOptions {
	readonly pinDirectModel?: (
		snapshot: KnobCaptureSnapshot,
	) => Effect.Effect<PinnedDirectModel, VoiceKnobRejected>;
	readonly speech: AiSpeechService;
	readonly hostTone?: (
		serial: string,
		tone: "start" | "end" | "error",
	) => Effect.Effect<void>;
	readonly localSpeech?: (
		settings: ReaderSettings,
		owner: { serial: string; keyCode: string },
	) => Pick<AiSpeechService, "createSpeech">;
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
	const report = (error: { readonly code: string }, serial?: string) =>
		Effect.gen(function* () {
			yield* options.speechError?.(error.code) ?? Effect.void;
			if (serial)
				yield* surface.publish({
					_tag: "Toast",
					serial,
					messageKey: "voiceOutput.unavailable",
					type: "error",
				});
		});
	const instrument = <A, E, R>(
		effect: Effect.Effect<A, E, R>,
		operation: "speech.capture" | "speech.recognize" | "speech.playback",
	) => options.diagnostics?.instrument(effect, operation) ?? effect;
	type Active = {
		readonly request: CaptureRequest;
		readonly fiber: Fiber.RuntimeFiber<void>;
		readonly metrics: Effect.Effect.Success<
			ReturnType<typeof createCaptureMetrics>
		>;
		session?: CaptureSession;
		released: boolean;
		terminal: boolean;
		listening: boolean;
		hasAudioFrame: boolean;
		transcript?: string;
	};
	let active: Active | undefined;
	let closed = false;
	let cleanup: Fiber.RuntimeFiber<void> | undefined;
	let cleanupSerial = "";
	let lastOwnerSerial: string | undefined;
	const knobProfiles = new Map<string, CaptureRequest>();
	let readAloud: Fiber.RuntimeFiber<SpeechOutcome> | undefined;
	let readAloudOwner: { serial: string; keyCode: string } | undefined;
	let readAloudSequence = 0;
	let cancelReadAloud: (() => Effect.Effect<void>) | undefined;
	const readers = new Map<
		string,
		{ keyCode: string; settings: ReaderSettings; sessionId: string }
	>();
	const readerPhase = (
		serial: string,
		phase: "idle" | "thinking" | "speaking",
	) =>
		Effect.suspend(() => {
			const owner = readers.get(serial);
			return owner
				? surface.publish({
						_tag: "ReadAloudState",
						serial,
						keyCode: owner.keyCode,
						sessionId: owner.sessionId,
						phase,
					})
				: Effect.void;
		});
	const turns = new Map<
		string,
		{
			readonly id: string;
			readonly keyCode: string;
			readonly speech: OrderedSpeech;
			readonly capture: CaptureRequest | undefined;
			readonly completionPhrase?: string | undefined;
			seq: number;
		}
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
	const cancelSpeech = Effect.fn("DesktopSpeech.cancelSpeech")(function* (
		serial?: string,
	) {
		for (const [id, turn] of turns)
			if (!serial || id === serial) {
				turns.delete(id);
				yield* turn.speech.cancel();
			}

		const reader = readAloud;
		if (reader && (!serial || readAloudOwner?.serial === serial)) {
			if (cancelReadAloud) yield* cancelReadAloud();
			yield* Fiber.interrupt(reader);
			if (readAloud === reader) readAloud = undefined;
		}
	});
	const stopOwner = Effect.fn("DesktopSpeech.stopCapture")(function* (
		owner: Active | undefined,
	) {
		if (!owner) return;
		owner.released = true;
		yield* owner.metrics.stop;
		yield* Fiber.interrupt(owner.fiber);
		if (active === owner) active = undefined;
	});
	const stop = () => stopOwner(active);
	yield* Effect.addFinalizer(() =>
		Effect.gen(function* () {
			closed = true;
			yield* stop();
			yield* cancelSpeech();
			for (const serial of readers.keys()) yield* readerPhase(serial, "idle");
			readers.clear();
		}),
	);
	const runtime = GridVoiceRuntime.of({
		select: (serial, keyCode) =>
			Effect.gen(function* () {
				if (active && active.request.serial !== serial) return;
				if (
					active &&
					(active.request.serial !== serial ||
						active.request.keyCode !== keyCode)
				)
					yield* stop();
				yield* cancelSpeech(serial);
			}),
		startCapture: (request) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					if (closed) return yield* new VoiceRuntimeUnavailable();
					if (
						cleanup &&
						cleanupSerial !== request.serial &&
						Option.isNone(yield* Fiber.poll(cleanup))
					)
						return yield* new VoiceKnobRejected("Busy");
					if (active && active.request.serial !== request.serial)
						return yield* new VoiceKnobRejected("Busy");
					if (
						lastOwnerSerial &&
						lastOwnerSerial !== request.serial &&
						(Option.isSome(yield* surface.activeFlow(lastOwnerSerial)) ||
							turns.get(lastOwnerSerial)?.speech.isBusy())
					)
						return yield* new VoiceKnobRejected("Busy");
					if (request.type === "knob" && !request.knob)
						return yield* new VoiceKnobRejected("RouteIncomplete");
					if (
						active?.request.serial === request.serial &&
						active.request.keyCode === request.keyCode &&
						active.request.generation === request.generation
					)
						return;
					const previous = active;
					if (!cleanup) {
						cleanupSerial = request.serial;
						cleanup = yield* Effect.gen(function* () {
							yield* stopOwner(previous);
							yield* cancelSpeech();
							yield* options.cancelText?.(request.serial, request.keyCode) ??
								Effect.void;
						}).pipe(Effect.forkIn(scope));
					}
					const cleaning = cleanup;
					const start = yield* Effect.makeLatch();
					let owner: Active;
					const metrics = yield* createCaptureMetrics();
					let terminal: CaptureMetrics["terminal"] = "failed";
					if (request.knob) knobProfiles.set(request.serial, request);
					else knobProfiles.delete(request.serial);
					const body = Effect.gen(function* () {
						yield* stage(owner, { _tag: "recording", status: "preparing" });
						const [directModel] = yield* Effect.all(
							[
								request.knob
									? (
											options.pinDirectModel?.(request.knob) ??
											Effect.fail(new VoiceKnobRejected("RouteIncomplete"))
										).pipe(
											Effect.timeoutFail({
												duration: "10 seconds",
												onTimeout: () =>
													new VoiceKnobRejected("RouteIncomplete"),
											}),
										)
									: Effect.succeed(undefined),
								Effect.gen(function* () {
									const cleaned = yield* Fiber.await(cleaning).pipe(
										Effect.timeoutOption("2 seconds"),
									);
									if (Option.isNone(cleaned))
										return yield* new VoiceKnobRejected("Busy");
									if (Exit.isFailure(cleaned.value))
										return yield* new VoiceKnobRejected(
											"Busy",
											cleaned.value.cause,
										);
									if (cleanup === cleaning) cleanup = undefined;
								}),
							],
							{ concurrency: "unbounded" },
						);
						if (owner.released || active !== owner) return;
						if (request.knob) {
							while (knobProfiles.size > 16) {
								const first = knobProfiles.keys().next();
								if (!first.done) knobProfiles.delete(first.value);
							}
						}
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
						let activity = initialVoiceActivity;
						let lastLevel = Option.none<number>();
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
									yield* metrics.ready;
									if (isKnobVoiceKey(request.keyCode))
										yield* Effect.sleep("58 seconds").pipe(
											Effect.zipRight(
												Effect.gen(function* () {
													if (active !== owner || owner.released) return;
													owner.released = true;
													yield* metrics.stop;
													yield* session.stop;
													yield* stage(owner, { _tag: "processing" });
												}),
											),
											Effect.forkScoped,
										);
									yield* stage(owner, {
										_tag: "recording",
										status: "listening",
									});
								}),
							(frame) =>
								Effect.gen(function* () {
									if (active !== owner) return;
									owner.hasAudioFrame = true;
									yield* metrics.frame;
									if (owner.released) return;
									const next = stepVoiceActivity(activity, frame.peak);
									if (next.detected !== activity.detected) {
										yield* stage(owner, {
											_tag: "recording",
											status: next.detected ? "speaking" : "listening",
											transcript: owner.transcript,
										});
									}
									activity = next;
									const level = meterLevel({
										analyserRms: frame.rms,
										peak: frame.peak,
									});
									const now = yield* Clock.currentTimeMillis;
									if (!shouldEmitLevel(lastLevel, now, level.speaking)) return;
									lastLevel = Option.some(now);
									yield* surface.publish({
										_tag: "Level",
										serial: request.serial,
										keyCode: request.keyCode,
										captureId: request.captureId,
										...level,
									});
								}),
							metrics.stop,
						);
						yield* options.hostTone?.(request.serial, "start") ?? Effect.void;
						const transcript = yield* instrument(
							options.speech.recognize(profiles.stt, frames, (value) => {
								owner.transcript = value.text.slice(0, 8000);
								return value.final
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
														status: activity.detected
															? "speaking"
															: "listening",
														transcript: value.text.slice(0, 8000),
													},
										);
							}),
							"speech.recognize",
						);
						if (active !== owner) return;
						yield* options.hostTone?.(request.serial, "end") ?? Effect.void;
						yield* metrics.stop;
						if (!/[\p{L}\p{N}]/u.test(transcript)) {
							terminal = "empty";
							yield* stage(owner, {
								_tag: "idle",
								outcome: "empty",
								emptyReason: owner.hasAudioFrame ? "unclear" : "noAudio",
							});
							owner.terminal = true;
							return;
						}
						yield* stage(owner, {
							_tag: "processing",
							transcript: transcript.slice(0, 8000),
						});
						terminal = "completed";
						// Capture is finalized and mic/socket are physically released before chat.
						yield* stage(owner, { _tag: "idle", outcome: "completed" });
						yield* options.sendTranscript({
							serial: request.serial,
							keyCode: request.keyCode,
							agentId: Option.getOrElse(request.agentId, () => ""),
							message: transcript.slice(0, 8000),
							...(request.knob ? { knob: request.knob } : {}),
							...(directModel ? { directModel } : {}),
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
							return (
								options.hostTone?.(request.serial, "error") ?? Effect.void
							).pipe(
								Effect.zipRight(
									stage(owner, {
										_tag: "failed",
										reason:
											failure instanceof DesktopSpeechError &&
											(failure.code === "VOICE.CAPTURE.NO_DEVICE" ||
												failure.code === "VOICE.CAPTURE.PERMISSION_DENIED" ||
												failure.code === "VOICE.CAPTURE.RECORDER_UNAVAILABLE")
												? "noMic"
												: "server",
										errorCode: failure.code,
									}),
								),
							);
						}),
						Effect.onInterrupt(() =>
							Effect.sync(() => {
								terminal = "cancelled";
							}).pipe(
								Effect.zipRight(
									stage(owner, { _tag: "idle", outcome: "cancelled" }),
								),
							),
						),
						Effect.ensuring(
							Effect.suspend(() => metrics.finish(terminal)).pipe(
								Effect.flatMap(
									(value) =>
										options.diagnostics?.recordCapture?.(value) ?? Effect.void,
								),
							),
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
						metrics,
						released: false,
						terminal: false,
						listening: false,
						hasAudioFrame: false,
					};
					active = owner;
					lastOwnerSerial = request.serial;
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
					yield* owner.metrics.stop;
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
					const pinned = knobProfiles.get(serial);
					if (pinned?.keyCode === keyCode && pinned.generation === generation) {
						knobProfiles.delete(serial);
						yield* options.cancelText?.(serial, keyCode) ?? Effect.void;
						yield* cancelSpeech(serial);
					}
				}),
			),
		interruptOwner: (serial) =>
			Effect.sync(() => {
				if (readAloud && readAloudOwner?.serial === serial)
					return Option.some(readAloudOwner.keyCode);
				const turn = turns.get(serial);
				return turn?.speech.isBusy()
					? Option.some(turn.keyCode)
					: Option.none();
			}),
		cancelFlow: (serial, keyCode) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					if (
						active?.request.serial === serial &&
						active.request.keyCode === keyCode
					)
						yield* stop();
					if (knobProfiles.get(serial)?.keyCode === keyCode)
						knobProfiles.delete(serial);
					yield* cancelSpeech(serial);
					yield* options.cancelText?.(serial, keyCode) ?? Effect.void;
				}),
			),
		sendText: (request) => options.sendText(request),
	});
	return {
		runtime,
		toggleReader: Effect.fn("DesktopSpeech.toggleReader")(
			(owner: { serial: string; keyCode: string }, settings: ReaderSettings) =>
				lock.withPermits(1)(
					Effect.gen(function* () {
						const previous = readers.get(owner.serial);
						const turn = turns.get(owner.serial);
						if (previous) {
							if (turn) {
								yield* turn.speech.cancel();
								turns.delete(owner.serial);
							}
							yield* readerPhase(owner.serial, "idle");
							readers.delete(owner.serial);
							if (previous.keyCode === owner.keyCode) return;
						}
						readers.set(owner.serial, {
							keyCode: owner.keyCode,
							settings,
							sessionId: `reader/${++readAloudSequence}`,
						});
						yield* readerPhase(owner.serial, "thinking");
					}),
				),
		),
		cancelSpeech,
		reconcileProfiles: Effect.fn("DesktopSpeech.reconcileProfiles")(
			(ids: readonly string[]) =>
				lock.withPermits(1)(
					Effect.gen(function* () {
						for (const [serial, request] of knobProfiles) {
							if (request.knob && ids.includes(request.knob.profileId))
								continue;
							knobProfiles.delete(serial);
							if (active?.request === request) yield* stop();
							yield* options.cancelText?.(serial, request.keyCode) ??
								Effect.void;
							const turn = turns.get(serial);
							if (turn?.capture === request) {
								turns.delete(serial);
								yield* turn.speech.cancel();
							}
							// Read-aloud is independent of device/profile capture ownership.
						}
					}),
				),
		),
		stopReadAloud: Effect.fn("DesktopSpeech.stopReadAloud")(
			(owner: { readonly serial: string; readonly keyCode: string }) =>
				lock.withPermits(1)(
					Effect.gen(function* () {
						if (
							!readAloud ||
							readAloudOwner?.serial !== owner.serial ||
							readAloudOwner.keyCode !== owner.keyCode
						)
							return false;
						yield* cancelSpeech(owner.serial);
						return true;
					}),
				),
		),
		reset: Effect.fn("DesktopSpeech.reset")(function* () {
			yield* lock.withPermits(1)(stop());
			yield* cancelSpeech();
			for (const serial of readers.keys()) yield* readerPhase(serial, "idle");
			readers.clear();
		}),
		readAloud: Effect.fn("DesktopSpeech.readAloud")(function* (
			text: string,
			owner?: { readonly serial: string; readonly keyCode: string },
			settings?: ReaderSettings,
		): Effect.fn.Return<SpeechOutcome> {
			const replacement = yield* lock.withPermits(1)(
				Effect.gen(function* () {
					const toggling =
						owner &&
						readAloud &&
						readAloudOwner?.serial === owner.serial &&
						readAloudOwner.keyCode === owner.keyCode;
					yield* cancelSpeech();
					if (toggling) return { _tag: "completed" } as const;
					if (closed || active) return { _tag: "cancelled" } as const;
					const sessionId = `read-aloud/${++readAloudSequence}`;
					const start = yield* Effect.makeLatch();
					let fiber: Fiber.RuntimeFiber<SpeechOutcome>;
					let lastPhase = "";
					const phase = (phase: "idle" | "thinking" | "speaking") =>
						Effect.suspend(() => {
							if (!owner || readAloud !== fiber || lastPhase === phase)
								return Effect.void;
							lastPhase = phase;
							return surface.publish({
								_tag: "ReadAloudState",
								...owner,
								sessionId,
								phase,
							});
						});
					const body = Effect.gen(
						function* (): Effect.fn.Return<SpeechOutcome> {
							yield* phase("thinking");
							const profile = yield* options.profiles().pipe(
								Effect.timeoutFail({
									duration: "10 seconds",
									onTimeout: () => new AiUnavailable(),
								}),
								Effect.either,
							);
							if (
								(profile._tag === "Left" || !profile.right.tts) &&
								settings?.engine !== "webSpeech"
							)
								return {
									_tag: "textOnly",
									error:
										profile._tag === "Left"
											? profile.left
											: new AiUnavailable(),
								};
							const engine =
								settings?.engine === "webSpeech" && owner
									? options.localSpeech?.(settings, owner)
									: options.speech;
							if (!engine)
								return {
									_tag: "textOnly",
									error: new AiUnavailable(),
								} as const;
							const turn = yield* engine.createSpeech(
								profile._tag === "Right" ? profile.right.tts : undefined,
								text,
								phase,
								owner ? { kind: "device", ...owner } : { kind: "assistant" },
							);
							cancelReadAloud = turn.cancel;
							return yield* instrumentSpeechOutcome(
								turn.result,
								options.diagnostics?.instrument,
							).pipe(
								Effect.tap((outcome) =>
									outcome._tag === "textOnly"
										? report(outcome.error, owner?.serial)
										: Effect.void,
								),
							);
						},
					).pipe(
						Effect.ensuring(
							Effect.gen(function* () {
								yield* phase("idle");
								if (readAloud === fiber) {
									readAloud = undefined;
									readAloudOwner = undefined;
									cancelReadAloud = undefined;
								}
							}),
						),
					);
					fiber = yield* start.await.pipe(
						Effect.zipRight(body),
						Effect.forkIn(scope),
					);
					readAloud = fiber;
					readAloudOwner = owner;
					yield* start.open;
					return { _tag: "turn", fiber } as const;
				}),
			);
			if (replacement._tag !== "turn") return replacement;
			const result = yield* Fiber.await(replacement.fiber);
			if (Exit.isSuccess(result)) return result.value;
			if (Cause.isInterruptedOnly(result.cause)) return { _tag: "cancelled" };
			return yield* Effect.failCause(result.cause);
		}),
		observe: Effect.fn("DesktopSpeech.observe")(
			(event: VoiceSurfaceEvent): Effect.Effect<void> =>
				eventLock.withPermits(1)(
					Effect.gen(function* () {
						if (closed) return;
						if (event._tag === "Reset") {
							yield* cancelSpeech(event.serial);
							yield* readerPhase(event.serial, "idle");
							readers.delete(event.serial);
							return;
						}
						if (event._tag === "TurnStarted") {
							const capture =
								event.source === "voice" && event.keyCode === "0,1"
									? knobProfiles.get(event.serial)
									: undefined;
							if (!capture) knobProfiles.delete(event.serial);
							const old = turns.get(event.serial);
							if (old) yield* old.speech.cancel();
							turns.delete(event.serial);
							const reader = readers.get(event.serial);
							const profiles = yield* options.profiles().pipe(
								Effect.timeoutFail({
									duration: "10 seconds",
									onTimeout: () => new AiUnavailable(),
								}),
								Effect.either,
							);
							if (
								(!reader &&
									(profiles._tag === "Left" ||
										!profiles.right.speakAnswers ||
										!profiles.right.tts)) ||
								(reader?.settings.engine !== "webSpeech" &&
									(profiles._tag === "Left" || !profiles.right.tts))
							) {
								if (reader) {
									yield* report(new AiUnavailable(), event.serial);
									yield* readerPhase(event.serial, "idle");
									readers.delete(event.serial);
								}
								return;
							}
							if (reader && readers.get(event.serial) !== reader) return;
							const engine =
								reader?.settings.engine === "webSpeech"
									? options.localSpeech?.(reader.settings, {
											serial: event.serial,
											keyCode: reader.keyCode,
										})
									: options.speech;
							if (!engine) {
								yield* report(new AiUnavailable(), event.serial);
								yield* readerPhase(event.serial, "idle");
								readers.delete(event.serial);
								return;
							}
							const speech = yield* createOrderedSpeech({
								speech: engine,
								profile:
									profiles._tag === "Right" ? profiles.right.tts : undefined,
								target: {
									kind: "device",
									serial: event.serial,
									keyCode: reader?.keyCode ?? event.keyCode,
								},
								phase: reader
									? (phase) =>
											readers.get(event.serial) === reader
												? readerPhase(event.serial, phase)
												: Effect.void
									: undefined,
								report: (error) => report(error, event.serial),
								instrument: options.diagnostics?.instrument,
							}).pipe(Effect.provideService(Scope.Scope, scope));
							if (turns.size >= 16) {
								const oldest = turns.keys().next().value;
								if (oldest !== undefined) {
									yield* turns.get(oldest)?.speech.cancel() ?? Effect.void;
									turns.delete(oldest);
								}
							}
							turns.set(event.serial, {
								id: event.turnId,
								keyCode: event.keyCode,
								speech,
								capture,
								completionPhrase:
									profiles._tag === "Right" && profiles.right.speakAnswers
										? spokenStatus(
												profiles.right.tts?.language ?? "en",
												"finishedOutput",
											)
										: undefined,
								seq: -1,
							});
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
						else if (event.chunk.type === "end") {
							yield* turn.speech.finish(
								event.chunk.outcome === "timedOut"
									? "failed"
									: event.chunk.outcome,
								turn.completionPhrase,
							);
						}
					}),
				),
		),
	};
});
