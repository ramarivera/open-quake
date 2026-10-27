import { createHash, randomUUID } from "node:crypto";
import { Effect, Fiber, Layer, Schema, Stream } from "effect";
import type {
	ConversationScope,
	ConversationStart,
} from "../../../../../packages/edge/src/agent-http/conversation-repository.js";
import type { ConversationEvent } from "../../../../../packages/edge/src/agent-http/conversation-service.js";
import type { RuntimeError } from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import type { Usage } from "../../../../../packages/edge/src/ai/ai-contracts.js";
import {
	SessionId,
	TurnId,
} from "../../../../../packages/edge/src/chat/chat-contracts.js";
import {
	GridVoiceRuntime,
	VoiceRuntimeUnavailable,
	VoiceSurface,
} from "../../../../../packages/edge/src/voice/surface/index.js";
import type {
	PinnedAgentRoute,
	TextRequest,
} from "../../../../../packages/edge/src/voice/surface/voice-surface-ports.js";
import type { AgentConnectionSelection } from "../../shared/agent-connections";

export interface AgentHttpVoiceOptions {
	readonly validateAgentRoute?: (
		route: PinnedAgentRoute,
	) => Effect.Effect<boolean>;
	readonly selected: () => Effect.Effect<
		AgentConnectionSelection | undefined,
		RuntimeError
	>;
	readonly stream: (
		owner: string,
		input: ConversationStart,
	) => Stream.Stream<ConversationEvent, RuntimeError>;
	readonly clear?: (
		owner: string,
		scope: ConversationScope,
	) => Effect.Effect<void, RuntimeError>;
	readonly cancel: (owner: string, requestId: string) => Effect.Effect<void>;
	/** Changes synchronously before cancellation starts, suppressing stale output. */
	readonly generation: () => number;
}

/** Text and normalized transcripts share the same consumer; microphone capture stays with the fallback. */
export const createAgentHttpVoiceAdapter = Effect.fn(
	"AgentHttp.createVoiceAdapter",
)(function* (
	options: AgentHttpVoiceOptions,
	fallback: typeof GridVoiceRuntime.Service,
	fallbackTranscript?: typeof fallback.sendText,
) {
	const surface = yield* VoiceSurface;
	const scope = yield* Effect.scope;
	const lock = yield* Effect.makeSemaphore(1);
	const active = new Map<
		string,
		{ keyCode: string; requestId: string; fiber: Fiber.RuntimeFiber<void> }
	>();
	const sessions = new Map<
		string,
		{
			local: string;
			ui: SessionId;
			serial: string;
			keyCode: string;
			connectionId: string;
			agentId?: string;
		}
	>();
	let closed = false;
	const stop = (serial: string, keyCode?: string): Effect.Effect<void> =>
		Effect.gen(function* () {
			const turn = active.get(serial);
			if (!turn || (keyCode !== undefined && turn.keyCode !== keyCode)) return;
			yield* options.cancel("voice", turn.requestId);
			yield* Fiber.interrupt(turn.fiber);
			if (active.get(serial) === turn) active.delete(serial);
		});
	yield* Effect.addFinalizer(() =>
		Effect.gen(function* () {
			closed = true;
			for (const serial of [...active.keys()]) yield* stop(serial);
			sessions.clear();
		}),
	);

	const send = (request: TextRequest, source: "typed" | "voice") =>
		Effect.gen(function* () {
			// A committed direct knob route never follows the mutable external selection.
			if (request.knob?.route === "direct")
				return yield* fallbackTranscript
					? fallbackTranscript(request)
					: fallback.sendText(request);
			if (
				request.knob?.route === "dkclaw" &&
				(!request.agentRoute ||
					!(yield* options.validateAgentRoute?.(request.agentRoute) ??
						Effect.succeed(false)))
			)
				return yield* new VoiceRuntimeUnavailable();
			const selected =
				request.agentRoute ??
				(yield* options
					.selected()
					.pipe(
						Effect.catchAll((cause) =>
							Effect.fail(new VoiceRuntimeUnavailable(cause)),
						),
					));
			const selectedGeneration = options.generation();
			return yield* lock.withPermits(1)(
				Effect.gen(function* () {
					if (closed || selectedGeneration !== options.generation())
						return yield* new VoiceRuntimeUnavailable();
					// Agent.id on a QUAKE key belongs to the local workspace. Only the
					// explicitly selected external ID may enter an HTTP request.
					if (!selected)
						return yield* source === "voice" && fallbackTranscript
							? fallbackTranscript(request)
							: fallback.sendText(request);
					yield* stop(request.serial);
					const requestId = randomUUID();
					const turnId = Schema.decodeUnknownSync(TurnId)(requestId);
					const generation = options.generation();
					const route = JSON.stringify([
						generation,
						request.serial,
						request.keyCode,
						selected.connectionId,
						selected.agentId ?? null,
						request.agentRoute?.modelId ?? null,
					]);
					const previous = sessions.get(route);
					const sessionId =
						previous?.ui ?? Schema.decodeUnknownSync(SessionId)(randomUUID());
					const captureId = `http/${requestId}`;
					let seq = 0;
					let ended = false;
					let connected = false;
					let usage: Usage | undefined;
					const current = () =>
						!closed &&
						generation === options.generation() &&
						active.get(request.serial)?.requestId === requestId;
					const terminal = (
						outcome: "completed" | "cancelled" | "failed",
						errorCode?: string,
					) =>
						Effect.gen(function* () {
							if (ended) return;
							ended = true;
							if (outcome === "failed")
								yield* surface.publish({
									_tag: "AgentStatus",
									state: "disconnected",
								});
							yield* surface.publish({
								_tag: "Chunk",
								serial: request.serial,
								keyCode: request.keyCode,
								chunk: {
									version: 1,
									sessionId,
									turnId,
									seq: seq++,
									type: "end",
									outcome,
									...(errorCode ? { errorCode } : {}),
									...(usage ? { usage } : {}),
								},
							});
							yield* surface.publish({
								_tag: "Stage",
								serial: request.serial,
								keyCode: request.keyCode,
								captureId,
								stage:
									outcome === "failed"
										? {
												_tag: "failed",
												reason: "server",
												...(errorCode ? { errorCode } : {}),
											}
										: { _tag: "idle", outcome },
							});
						});
					const consume = options
						.stream("voice", {
							connectionId: selected.connectionId,
							requestId,
							text: request.message,
							...(selected.agentId === undefined
								? {}
								: { agentId: selected.agentId }),
							...(previous ? { sessionId: previous.local } : {}),
							...(request.agentRoute?.modelId
								? { modelId: request.agentRoute.modelId }
								: {}),
						})
						.pipe(
							Stream.runForEach((envelope) =>
								Effect.gen(function* () {
									if (!current() || ended) return;
									sessions.set(route, {
										local: envelope.sessionId,
										serial: request.serial,
										keyCode: request.keyCode,
										connectionId: selected.connectionId,
										...(selected.agentId ? { agentId: selected.agentId } : {}),
										ui: sessionId,
									});
									while (sessions.size > 16) {
										const oldest = sessions.keys().next();
										if (!oldest.done) sessions.delete(oldest.value);
									}
									if (envelope.type === "end")
										return yield* terminal(
											envelope.outcome,
											envelope.errorCode,
										);
									const event = envelope.event;
									if (!connected) {
										connected = true;
										yield* surface.publish({
											_tag: "AgentStatus",
											state: "connected",
										});
									}
									switch (event._tag) {
										case "textDelta":
											return yield* surface.publish({
												_tag: "Chunk",
												serial: request.serial,
												keyCode: request.keyCode,
												chunk: {
													version: 1,
													sessionId,
													turnId,
													seq: seq++,
													type: "answer",
													textDelta: event.textDelta,
												},
											});
										case "tool":
											return yield* surface.publish({
												_tag: "Tool",
												serial: request.serial,
												keyCode: request.keyCode,
												turnId,
												toolCallId:
													event.toolCallId.length <= 128
														? event.toolCallId
														: `http-tool-${createHash("sha256").update(event.toolCallId).digest("hex")}`,
												name: event.tool.slice(0, 128),
												phase:
													event.phase === "completed"
														? "result"
														: event.phase === "failed"
															? "error"
															: "start",
												...(event.arguments === undefined
													? {}
													: { args: event.arguments.slice(0, 8000) }),
											});
										case "usage":
											usage = event.usage;
											return;
										case "status":
										case "completed":
											return;
									}
								}),
							),
							Effect.catchAll((error) =>
								current() ? terminal("failed", error.code) : Effect.void,
							),
							Effect.onInterrupt(() =>
								current() ? terminal("cancelled") : Effect.void,
							),
							Effect.ensuring(
								Effect.sync(() => {
									if (active.get(request.serial)?.requestId === requestId)
										active.delete(request.serial);
								}),
							),
						);
					yield* surface.publish({
						_tag: "TurnStarted",
						serial: request.serial,
						keyCode: request.keyCode,
						sessionId,
						turnId,
						prompt: request.message.slice(0, 8000),
						source,
						...(selected.agentId === undefined
							? {}
							: {
									agent: {
										id: selected.agentId.slice(0, 128),
										name: selected.agentId.slice(0, 128),
									},
								}),
					});
					yield* surface.publish({
						_tag: "Stage",
						serial: request.serial,
						keyCode: request.keyCode,
						captureId,
						stage: { _tag: "processing" },
					});
					// Install ownership before the fork can publish synchronous fixture events.
					const start = yield* Effect.makeLatch();
					const fiber = yield* start.await.pipe(
						Effect.zipRight(consume),
						Effect.forkIn(scope),
					);
					active.set(request.serial, {
						keyCode: request.keyCode,
						requestId,
						fiber,
					});
					yield* start.open;
				}),
			);
		});
	return {
		sendTranscript: (request: TextRequest) => send(request, "voice"),
		cancelText: (serial: string, keyCode: string) =>
			lock.withPermits(1)(stop(serial, keyCode)),
		runtime: GridVoiceRuntime.of({
			...fallback,
			resetContext: (serial, keyCode) =>
				lock.withPermits(1)(
					Effect.gen(function* () {
						const selected = yield* options
							.selected()
							.pipe(
								Effect.mapError((cause) => new VoiceRuntimeUnavailable(cause)),
							);
						if (!selected)
							return yield* fallback.resetContext
								? fallback.resetContext(serial, keyCode)
								: new VoiceRuntimeUnavailable();
						const clear = options.clear;
						if (!clear) return yield* new VoiceRuntimeUnavailable();
						yield* stop(serial, keyCode);
						for (const [route, session] of sessions) {
							if (session.serial !== serial || session.keyCode !== keyCode)
								continue;
							yield* clear("voice", {
								connectionId: session.connectionId,
								sessionId: session.local,
								...(session.agentId ? { agentId: session.agentId } : {}),
							}).pipe(
								Effect.mapError((cause) => new VoiceRuntimeUnavailable(cause)),
							);
							sessions.delete(route);
						}
					}),
				),
			select: (serial, keyCode, type, agentId) =>
				lock.withPermits(1)(
					Effect.gen(function* () {
						const previous = active.get(serial);
						if (previous && (type === "aiChat" || previous.keyCode !== keyCode))
							yield* stop(serial);
						yield* fallback.select(serial, keyCode, type, agentId);
					}),
				),
			cancelFlow: (serial, keyCode) =>
				lock
					.withPermits(1)(stop(serial, keyCode))
					.pipe(Effect.zipRight(fallback.cancelFlow(serial, keyCode))),
			sendText: (request) => send(request, "typed"),
		}),
	};
});

export const agentHttpVoiceLayer = (
	options: AgentHttpVoiceOptions,
	fallback: Layer.Layer<GridVoiceRuntime, never, VoiceSurface>,
): Layer.Layer<GridVoiceRuntime, never, VoiceSurface> =>
	Layer.scoped(
		GridVoiceRuntime,
		Effect.gen(function* () {
			const existing = yield* GridVoiceRuntime;
			return (yield* createAgentHttpVoiceAdapter(options, existing)).runtime;
		}),
	).pipe(Layer.provide(fallback));
