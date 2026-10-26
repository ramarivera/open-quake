import { randomUUID } from "node:crypto";
import { Effect, Fiber, Schema, Stream } from "effect";
import {
	SessionId,
	TurnId,
} from "../../../../../packages/edge/src/chat/chat-contracts";
import {
	GridVoiceRuntime,
	VoiceRuntimeUnavailable,
	VoiceSurface,
} from "../../../../../packages/edge/src/voice/surface";
import { VoiceKnobRejected } from "../../../../../packages/edge/src/voice/surface/voice-surface-errors";
import type { TextRequest } from "../../../../../packages/edge/src/voice/surface/voice-surface-ports";
import type { DirectChat } from "./host";
/** Direct Copilot route. The outer HTTP decorator exclusively owns external-agent selection. */
export const createDirectChatVoice = (
	host: DirectChat,
	fallback: typeof GridVoiceRuntime.Service,
) =>
	Effect.gen(function* () {
		const surface = yield* VoiceSurface;
		const scope = yield* Effect.scope;
		const lock = yield* Effect.makeSemaphore(1);
		const sessions = new Map<
			string,
			{ sessionId: SessionId; serial: string; keyCode: string }
		>();
		const active = new Map<
			string,
			{
				sessionId: SessionId;
				turnId: TurnId;
				fiber: Fiber.RuntimeFiber<void>;
				keyCode: string;
			}
		>();
		// A reset invalidates ownership immediately, before waiting on the acceptance lock.
		const identities = new Map<
			string,
			{ readonly keyCode: string; readonly token: symbol }
		>();
		const invalidate = (serial: string, keyCode?: string) =>
			Effect.sync(() => {
				const identity = identities.get(serial);
				if (identity && (keyCode === undefined || identity.keyCode === keyCode))
					identities.delete(serial);
			});
		const cancelTurn = (sessionId: SessionId, turnId: TurnId) =>
			Effect.promise(() =>
				host.runtime.runPromise(
					host.cancel(sessionId, turnId).pipe(Effect.ignore),
				),
			);
		const stop = (serial: string, keyCode?: string) =>
			Effect.gen(function* () {
				yield* invalidate(serial, keyCode);
				const turn = active.get(serial);
				if (!turn || (keyCode !== undefined && turn.keyCode !== keyCode))
					return;
				yield* cancelTurn(turn.sessionId, turn.turnId);
				// Cancellation queues the authoritative terminal. Let the surface consumer
				// publish it and release activeFlow before returning.
				yield* Fiber.await(turn.fiber);
				if (active.get(serial) === turn) active.delete(serial);
			});
		yield* Effect.addFinalizer(() =>
			Effect.forEach([...active.keys()], (serial) => stop(serial), {
				discard: true,
			}),
		);
		const send = (request: TextRequest, source: "typed" | "voice") =>
			lock.withPermits(1)(
				Effect.uninterruptibleMask((restore) =>
					Effect.gen(function* () {
						if (request.knob && !request.directModel)
							return yield* new VoiceRuntimeUnavailable(
								new VoiceKnobRejected("RouteIncomplete"),
							);
						yield* stop(request.serial);
						const route = JSON.stringify([
							request.serial,
							request.keyCode,
							request.agentId,
							request.knob,
							request.directModel?.profile.id,
						]);
						let sessionId = sessions.get(route)?.sessionId;
						if (!sessionId) {
							sessionId = Schema.decodeUnknownSync(SessionId)(randomUUID());
							sessions.set(route, {
								sessionId,
								serial: request.serial,
								keyCode: request.keyCode,
							});
							while (sessions.size > 16) {
								const first = sessions.keys().next();
								if (!first.done) sessions.delete(first.value);
							}
						}
						const turnId = Schema.decodeUnknownSync(TurnId)(randomUUID());
						const settings = request.knob
							? request.knob.assistantSettings
							: yield* Effect.tryPromise({
									try: () =>
										host.runtime.runPromise(
											host.keySettings(request.serial, request.keyCode),
										),
									catch: (cause) => new VoiceRuntimeUnavailable(cause),
								});
						if (source === "voice" && settings && !settings.enableVoiceInput)
							return yield* new VoiceRuntimeUnavailable();
						const token = Symbol("assistant-session");
						identities.set(request.serial, { keyCode: request.keyCode, token });
						const accepted = yield* Effect.tryPromise({
							try: (signal) =>
								host.runtime.runPromise(
									host.submit(
										{ sessionId, turnId, text: request.message },
										request.agentId,
										request.directModel,
										settings,
										() => identities.get(request.serial)?.token === token,
									),
									{ signal },
								),
							catch: (cause) => new VoiceRuntimeUnavailable(cause),
						}).pipe(
							Effect.onError(() => invalidate(request.serial, request.keyCode)),
						);
						const captureId = `direct/${turnId}`;
						yield* surface.publish({
							_tag: "TurnStarted",
							serial: request.serial,
							keyCode: request.keyCode,
							sessionId,
							turnId,
							prompt: request.message.slice(0, 8000),
							source,
						});
						yield* surface.publish({
							_tag: "Stage",
							serial: request.serial,
							keyCode: request.keyCode,
							captureId,
							stage: { _tag: "processing" },
						});
						const start = yield* Effect.makeLatch();
						const fiber = yield* start.await.pipe(
							Effect.zipRight(
								accepted.events.pipe(
									Stream.runForEach((chunk) =>
										surface
											.publish({
												_tag: "Chunk",
												serial: request.serial,
												keyCode: request.keyCode,
												chunk,
											})
											.pipe(
												Effect.zipRight(
													chunk.type === "end"
														? surface.publish({
																_tag: "Stage",
																serial: request.serial,
																keyCode: request.keyCode,
																captureId,
																stage:
																	chunk.outcome === "completed" ||
																	chunk.outcome === "cancelled"
																		? { _tag: "idle", outcome: chunk.outcome }
																		: {
																				_tag: "failed",
																				reason: "server",
																				...(chunk.errorCode
																					? { errorCode: chunk.errorCode }
																					: {}),
																			},
															})
														: Effect.void,
												),
											),
									),
									Effect.catchAll((error) =>
										surface.publish({
											_tag: "Stage",
											serial: request.serial,
											keyCode: request.keyCode,
											captureId,
											stage: {
												_tag: "failed",
												reason: "server",
												errorCode: error.code,
											},
										}),
									),
									// Scoped shutdown interrupts this consumer before the adapter's
									// finalizer sees active. Cancel upstream before removing ownership.
									Effect.onInterrupt(() => cancelTurn(sessionId, turnId)),
									Effect.ensuring(
										Effect.sync(() => {
											if (active.get(request.serial)?.turnId === turnId)
												active.delete(request.serial);
										}),
									),
								),
							),
							Effect.interruptible,
							Effect.forkIn(scope),
						);
						active.set(request.serial, {
							sessionId,
							turnId,
							fiber,
							keyCode: request.keyCode,
						});
						yield* start.open;
						// Acceptance and installation are one ownership handoff. A capture
						// interrupted while awaiting acceptance cancels only after ownership
						// exists, then drains the terminal before releasing the caller.
						yield* restore(Effect.void).pipe(
							Effect.onInterrupt(() => stop(request.serial, request.keyCode)),
						);
					}),
				),
			);
		return {
			sendTranscript: (request: TextRequest) => send(request, "voice"),
			cancelText: (serial: string, keyCode: string) =>
				invalidate(serial, keyCode).pipe(
					Effect.zipRight(lock.withPermits(1)(stop(serial, keyCode))),
				),
			runtime: GridVoiceRuntime.of({
				...fallback,
				resetContext: (serial, keyCode) =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							yield* stop(serial, keyCode);
							for (const [route, session] of sessions) {
								if (session.serial !== serial || session.keyCode !== keyCode)
									continue;
								yield* Effect.tryPromise({
									try: () =>
										host.runtime.runPromise(host.clear(session.sessionId)),
									catch: (cause) => new VoiceRuntimeUnavailable(cause),
								});
								sessions.delete(route);
							}
						}),
					),
				sendText: (request) => send(request, "typed"),
				select: (serial, keyCode, type, agentId) =>
					invalidate(serial).pipe(
						Effect.zipRight(
							lock.withPermits(1)(
								stop(serial).pipe(
									Effect.zipRight(
										fallback.select(serial, keyCode, type, agentId),
									),
								),
							),
						),
					),
				cancelFlow: (serial, keyCode) =>
					invalidate(serial, keyCode).pipe(
						Effect.zipRight(lock.withPermits(1)(stop(serial, keyCode))),
						Effect.zipRight(fallback.cancelFlow(serial, keyCode)),
					),
			}),
		};
	});
