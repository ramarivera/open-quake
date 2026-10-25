import {
	Cause,
	Clock,
	Deferred,
	Effect,
	Either,
	Option,
	Queue,
	Ref,
	Schema,
	Stream,
} from "effect";
import type {
	InferenceRequest,
	NormalizedEvent,
	ProviderProfile,
	Usage,
} from "../ai/ai-contracts.js";
import {
	AiCapabilityUnsupported,
	AiConfigInvalid,
	type AiError,
	AiErrors,
	AiProtocolInvalid,
} from "../ai/ai-errors.js";
import { validateRequest } from "../ai/ai-invariants.js";
import { prepareWorkflow } from "../ai/ai-provider-quirks.js";
import { AiRepository } from "../ai/ai-repository.js";
import type { Generation } from "../ai/ai-service.js";
import type {
	ChatChunk,
	Session,
	SessionId,
	Terminal,
	TurnId,
	TurnSelection,
	TurnSnapshot,
} from "./chat-contracts.js";
import {
	ChatBusy,
	ChatContextTooLarge,
	type ChatError,
	ChatErrors,
	ChatInvalid,
	ChatLimitExceeded,
	ChatModeUnavailable,
	ChatNotFound,
	ChatResyncRequired,
} from "./chat-errors.js";
import {
	budgetContext,
	emptySession,
	emptyTurn,
	estimatedTextTokens,
	reduceChunk,
	reduceSession,
	type TurnView,
} from "./chat-invariants.js";
import { ChatInference, ChatInferenceLive, ChatSubmit } from "./chat-ports.js";
import {
	type ChatHistory,
	ChatRepository,
	type SavedTurn,
} from "./chat-repository.js";

export interface ChatSubscription {
	readonly snapshot: TurnSnapshot;
	/** One consumer. Detachment never cancels the authoritative generation. */
	readonly events: Stream.Stream<ChatChunk, ChatError>;
}
export interface ChatTurn extends ChatSubscription {
	readonly selection: TurnSelection;
}
interface Subscriber {
	readonly queue: Queue.Queue<ChatChunk>;
	readonly failed: Deferred.Deferred<never, ChatResyncRequired>;
}
interface ActiveTurn {
	readonly owner: string;
	readonly selection: TurnSelection;
	readonly stop: Deferred.Deferred<Terminal>;
	readonly done: Deferred.Deferred<void>;
	readonly subscribers: Set<Subscriber>;
	readonly acceptedAt: bigint;
	readonly inputTokens: number;
	readonly outputReserve: number;
	view: TurnView;
	session: Session;
	history: ChatHistory;
	generation: Option.Option<Generation>;
	usage: Option.Option<Usage>;
	checkpointAt: number;
	checkpointBytes: number;
	checkpointSeq: number;
}
const key = (owner: string, id: SessionId) => JSON.stringify([owner, id]);
const selectionOf = (input: ChatSubmit): TurnSelection => ({
	sessionId: input.sessionId,
	turnId: input.turnId,
	profileId: input.profileId,
	modelId: input.modelId,
	authGeneration: input.authGeneration,
	mode: input.mode,
});
const terminalCodes = new Set<string>(
	[...Object.values(AiErrors), ...Object.values(ChatErrors)].map(
		(entry) => entry.code,
	),
);
const failureTerminal = (cause: Cause.Cause<unknown>): Terminal => {
	const failure = Cause.failureOption(cause);
	const value = Option.isSome(failure) ? failure.value : undefined;
	const code =
		typeof value === "object" &&
		value !== null &&
		"code" in value &&
		typeof value.code === "string" &&
		terminalCodes.has(value.code)
			? value.code
			: "AI.PROVIDER.UNAVAILABLE";
	return { outcome: "failed", errorCode: code };
};

/** One authoritative assembly per turn, scoped independently of subscribers and callers. */
export class ChatService extends Effect.Service<ChatService>()(
	"@open-quake/edge/ChatService",
	{
		accessors: true,
		dependencies: [
			ChatRepository.Default,
			AiRepository.Default,
			ChatInferenceLive,
		],
		scoped: Effect.gen(function* () {
			const repository = yield* ChatRepository;
			const profiles = yield* AiRepository;
			const inference = yield* ChatInference;
			const scope = yield* Effect.scope;
			const lock = yield* Effect.makeSemaphore(1);
			const active = new Map<string, ActiveTurn>();
			// Failed disk writes must not erase the terminal already delivered to live consumers.
			// Keep a bounded repair overlay, and persist it with the next successful session write.
			const unsavedTerminals = new Map<string, TurnSnapshot>();
			const turnKey = (owner: string, sessionId: SessionId, turnId: TurnId) =>
				JSON.stringify([owner, sessionId, turnId]);
			const present = (history: ChatHistory): ChatHistory => ({
				...history,
				turns: history.turns.map((turn) => {
					const snapshot = unsavedTerminals.get(
						turnKey(history.owner, history.sessionId, turn.selection.turnId),
					);
					return snapshot
						? { ...turn, snapshot, status: "failed" as const }
						: turn;
				}),
			});
			const repaired = (history: ChatHistory): void => {
				for (const turn of history.turns)
					if (turn.status !== "processing")
						unsavedTerminals.delete(
							turnKey(history.owner, history.sessionId, turn.selection.turnId),
						);
			};
			const idleMs = 30 * 60 * 1000;

			const read = Effect.fn("ChatService.read")(function* (
				owner: string,
				sessionId: SessionId,
			): Effect.fn.Return<ChatHistory, ChatError> {
				const value = yield* repository.get(owner, sessionId);
				if (Option.isNone(value)) return yield* new ChatNotFound();
				return present(value.value);
			});
			const store = (
				turn: ActiveTurn,
				saved: SavedTurn,
			): Effect.Effect<void, ChatError> =>
				Effect.gen(function* () {
					const previous = turn.history;
					const next = {
						...previous,
						revision: previous.revision + 1,
						updatedAt: yield* Clock.currentTimeMillis,
						turns: previous.turns.map((item) =>
							item.selection.turnId === saved.selection.turnId ? saved : item,
						),
					};
					yield* repository.put(next, previous.revision);
					turn.history = next;
					repaired(next);
				}).pipe(Effect.uninterruptible);
			const publish = (
				turn: ActiveTurn,
				chunk: ChatChunk,
			): Effect.Effect<void> =>
				Effect.gen(function* () {
					turn.view = reduceChunk(turn.view, chunk);
					for (const subscriber of turn.subscribers) {
						const offered = yield* Queue.offer(subscriber.queue, chunk);
						if (!offered) {
							turn.subscribers.delete(subscriber);
							yield* Deferred.fail(subscriber.failed, new ChatResyncRequired());
						}
					}
				});
			const attach = Effect.fn("ChatService.attach")(function* (
				turn: ActiveTurn,
			): Effect.fn.Return<ChatSubscription, ChatError> {
				if (turn.subscribers.size >= 8) return yield* new ChatLimitExceeded();
				const queue = yield* Queue.dropping<ChatChunk>(256);
				const failed = yield* Deferred.make<never, ChatResyncRequired>();
				const consumed = yield* Ref.make(false);
				const subscriber = { queue, failed };
				turn.subscribers.add(subscriber);
				const events = Stream.unwrapScoped(
					Effect.gen(function* () {
						if (yield* Ref.getAndSet(consumed, true))
							return Stream.fail(new ChatResyncRequired());
						yield* Effect.addFinalizer(() =>
							Effect.sync(() => turn.subscribers.delete(subscriber)).pipe(
								Effect.zipRight(Queue.shutdown(queue)),
							),
						);
						return Stream.fromQueue(queue).pipe(
							Stream.interruptWhen(Deferred.await(failed)),
							Stream.takeUntil((chunk) => chunk.type === "end"),
						);
					}),
				);
				return { snapshot: turn.view, events };
			});
			const append = (
				turn: ActiveTurn,
				event: NormalizedEvent,
			): Effect.Effect<void, ChatError> =>
				lock.withPermits(1)(
					Effect.gen(function* () {
						if (
							Option.isSome(turn.view.terminal) ||
							(yield* Deferred.isDone(turn.stop))
						)
							return;
						if (event._tag === "usage") {
							turn.usage = Option.some(event.usage);
							if (
								event.usage.provenance === "reported" &&
								event.usage.outputTokens > turn.outputReserve
							)
								return yield* new ChatLimitExceeded();
							return;
						}
						if (event._tag === "completed") return;
						if (
							event._tag === "textDelta" &&
							turn.view.text.length + event.textDelta.length > 65536
						)
							return yield* new ChatLimitExceeded();
						if (
							event._tag === "suggestion" &&
							(event.text.length > 4096 || turn.view.suggestions.length >= 16)
						)
							return yield* new ChatLimitExceeded();
						const envelope = {
							version: 1 as const,
							sessionId: turn.selection.sessionId,
							turnId: turn.selection.turnId,
							seq: turn.view.lastSeq + 1,
						};
						const chunk: ChatChunk =
							event._tag === "textDelta"
								? { ...envelope, type: "answer", textDelta: event.textDelta }
								: {
										...envelope,
										type: "followUp",
										suggestionId: event.suggestionId,
										text: event.text,
									};
						const next = reduceChunk(turn.view, chunk);
						const saved = turn.history.turns.find(
							(item) => item.selection.turnId === turn.selection.turnId,
						);
						if (!saved) return yield* new ChatNotFound();
						// Persist the first partial, then coalesce subsequent deltas.
						// Acceptance and terminal records always remain durable.
						const now = yield* Clock.currentTimeMillis;
						const bytes = estimatedTextTokens(next.text) - 8;
						if (
							turn.checkpointSeq < 0 ||
							now - turn.checkpointAt >= 1000 ||
							bytes - turn.checkpointBytes >= 4096
						) {
							yield* store(turn, { ...saved, snapshot: next });
							turn.checkpointAt = now;
							turn.checkpointBytes = bytes;
							turn.checkpointSeq = next.lastSeq;
						}
						if (!(yield* Deferred.isDone(turn.stop)))
							yield* publish(turn, chunk);
					}),
				);
			const finish = (
				turn: ActiveTurn,
				terminal: Terminal,
			): Effect.Effect<void> =>
				lock.withPermits(1)(
					Effect.gen(function* () {
						if (Option.isSome(turn.view.terminal)) return;
						const usage = Option.getOrElse(turn.usage, () => ({
							inputTokens: turn.inputTokens,
							outputTokens: estimatedTextTokens(turn.view.text) - 8,
							provenance: "estimated" as const,
						}));
						const finalTerminal: Terminal =
							terminal.outcome === "completed" &&
							usage.provenance === "reported" &&
							usage.outputTokens > turn.outputReserve
								? { outcome: "failed", errorCode: "CHAT.LIMIT.EXCEEDED" }
								: terminal;
						const chunk: ChatChunk = {
							version: 1,
							sessionId: turn.selection.sessionId,
							turnId: turn.selection.turnId,
							seq: turn.view.lastSeq + 1,
							type: "end",
							...finalTerminal,
							usage,
						};
						const saved = turn.history.turns.find(
							(item) => item.selection.turnId === turn.selection.turnId,
						);
						if (saved) {
							const result = yield* Effect.exit(
								store(turn, {
									...saved,
									status: finalTerminal.outcome,
									snapshot: reduceChunk(turn.view, chunk),
								}),
							);
							if (result._tag === "Failure") {
								const failure = failureTerminal(result.cause);
								yield* publish(turn, { ...chunk, ...failure });
								unsavedTerminals.set(
									turnKey(
										turn.owner,
										turn.selection.sessionId,
										turn.selection.turnId,
									),
									turn.view,
								);
							} else yield* publish(turn, chunk);
						} else
							yield* publish(turn, {
								...chunk,
								outcome: "failed",
								errorCode: "CHAT.SESSION.NOT_FOUND",
							});
						const final = Option.getOrElse(
							Option.map(turn.view.terminal, (value) => value.outcome),
							() => "failed" as const,
						);
						turn.session = reduceSession(turn.session, {
							type: "finish",
							sessionId: turn.selection.sessionId,
							turnId: turn.selection.turnId,
							outcome: final,
						});
						active.delete(key(turn.owner, turn.selection.sessionId));
						yield* Deferred.succeed(turn.done, undefined);
					}),
				);
			const run = (
				turn: ActiveTurn,
				profile: ProviderProfile,
				request: InferenceRequest,
			): Effect.Effect<void> =>
				Effect.uninterruptibleMask((restore) =>
					Effect.gen(function* () {
						const remainingMs = Math.max(
							0,
							60000 -
								Number((yield* Clock.currentTimeNanos) - turn.acceptedAt) / 1e6,
						);
						if (remainingMs <= 0) {
							yield* finish(turn, {
								outcome: "timedOut",
								errorCode: "CHAT.RESPONSE.TIMEOUT",
							});
							return;
						}
						const stopped = yield* Deferred.poll(turn.stop);
						if (Option.isSome(stopped)) {
							yield* finish(turn, yield* stopped.value);
							return;
						}
						const work = Effect.gen(function* () {
							turn.session = reduceSession(turn.session, {
								type: "dispatch",
								sessionId: turn.selection.sessionId,
								turnId: turn.selection.turnId,
							});
							const generation = yield* inference.open(profile, request);
							turn.generation = Option.some(generation);
							let completed = false;
							yield* Stream.runForEach(
								generation.events.pipe(
									Stream.takeUntil((event) => event._tag === "completed"),
								),
								(event) => {
									if (event._tag === "completed") completed = true;
									return append(turn, event);
								},
							);
							if (!completed) return yield* new AiProtocolInvalid();
							return { outcome: "completed" as const };
						}).pipe(
							Effect.ensuring(
								Effect.suspend(() =>
									Option.isSome(turn.generation)
										? turn.generation.value.cancel()
										: Effect.void,
								),
							),
						);
						const terminal = yield* restore(
							Effect.raceFirst(
								work,
								Effect.raceFirst(
									Deferred.await(turn.stop),
									Effect.sleep(remainingMs).pipe(
										Effect.zipRight(
											Deferred.succeed(turn.stop, {
												outcome: "timedOut",
												errorCode: "CHAT.RESPONSE.TIMEOUT",
											}),
										),
										Effect.zipRight(
											Effect.suspend(() =>
												Option.isSome(turn.generation)
													? turn.generation.value.cancel()
													: Effect.void,
											),
										),
										Effect.as({
											outcome: "timedOut" as const,
											errorCode: "CHAT.RESPONSE.TIMEOUT",
										}),
									),
								),
							),
						).pipe(
							Effect.catchAllCause((cause) =>
								Effect.succeed(
									Cause.isInterruptedOnly(cause)
										? { outcome: "cancelled" as const }
										: failureTerminal(cause),
								),
							),
						);
						const elapsedMs =
							Number((yield* Clock.currentTimeNanos) - turn.acceptedAt) / 1e6;
						const cancelled = yield* Deferred.poll(turn.stop);
						const result = Option.isSome(cancelled)
							? yield* cancelled.value
							: terminal.outcome === "completed" && elapsedMs >= 60000
								? {
										outcome: "timedOut" as const,
										errorCode: "CHAT.RESPONSE.TIMEOUT",
									}
								: terminal;
						yield* finish(turn, result);
					}),
				).pipe(Effect.withSpan("ChatService.turn"));

			const submit = Effect.fn("ChatService.submit")(
				(
					owner: string,
					unknownInput: unknown,
				): Effect.Effect<ChatTurn, ChatError | AiError> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							const decoded = Schema.decodeUnknownEither(ChatSubmit, {
								onExcessProperty: "error",
							})(unknownInput);
							if (Either.isLeft(decoded) || !owner.trim() || owner.length > 256)
								return yield* new ChatInvalid();
							const input = decoded.right;
							if (!input.text.trim()) return yield* new ChatInvalid();
							if (input.mode !== "normal")
								return yield* new ChatModeUnavailable();
							const id = key(owner, input.sessionId);
							if (active.has(id)) return yield* new ChatBusy();
							if (active.size >= 4 || unsavedTerminals.size + active.size >= 64)
								return yield* new ChatLimitExceeded();
							const existing = yield* repository.get(owner, input.sessionId);
							if (
								Option.isSome(existing) &&
								existing.value.turns.some(
									(turn) => turn.selection.turnId === input.turnId,
								)
							)
								return yield* new ChatInvalid();
							const storedProfile = yield* profiles.get(input.profileId);
							if (Option.isNone(storedProfile))
								return yield* new AiConfigInvalid();
							const profile = storedProfile.value;
							const role = input.modelRole ?? "daily";
							const modelId =
								profile.models?.[role] ??
								(role === "daily" ? profile.modelId : undefined);
							if (
								input.modelId !== modelId ||
								input.authGeneration !== profile.authGeneration
							)
								return yield* new AiConfigInvalid();
							const now = yield* Clock.currentTimeMillis;
							let history: ChatHistory = Option.isSome(existing)
								? present(existing.value)
								: {
										owner,
										sessionId: input.sessionId,
										title:
											Array.from(input.text).slice(0, 10).join("") +
											(Array.from(input.text).length > 10 ? "..." : ""),
										manualTitle: false,
										revision: -1,
										contextEpoch: 0,
										updatedAt: now,
										turns: [],
									};
							if (now - history.updatedAt >= idleMs)
								history = {
									...history,
									contextEpoch: history.contextEpoch + 1,
								};
							const outputReserve =
								input.outputReserveTokens ??
								profile.sampling.maxOutputTokens ??
								Math.min(profile.samplingLimits.maxOutputTokens ?? 1024, 1024);
							if (
								profile.samplingLimits.maxOutputTokens !== undefined &&
								outputReserve > profile.samplingLimits.maxOutputTokens
							)
								return yield* new AiConfigInvalid();
							const retained = budgetContext(
								input.systemPrompt ?? "",
								input.text,
								history.turns
									.filter(
										(turn) =>
											turn.contextEpoch === history.contextEpoch &&
											turn.status === "completed",
									)
									.map((turn) => ({
										input: turn.input,
										answer: turn.snapshot.text,
									})),
								input.contextWindowTokens ?? 8192,
								outputReserve,
							);
							if (Either.isLeft(retained))
								return yield* new ChatContextTooLarge();
							const request: InferenceRequest = {
								profileId: profile.id,
								modelRole: role,
								requestedCapabilities: ["text"],
								sampling:
									profile.samplingLimits.maxOutputTokens === undefined
										? {}
										: { maxOutputTokens: outputReserve },
								messages: [
									...(input.systemPrompt
										? [
												{
													role: "system" as const,
													content: [
														{ _tag: "text" as const, text: input.systemPrompt },
													],
												},
											]
										: []),
									...retained.right.flatMap((exchange) => [
										{
											role: "user" as const,
											content: [
												{ _tag: "text" as const, text: exchange.input },
											],
										},
										{
											role: "assistant" as const,
											content: [
												{ _tag: "text" as const, text: exchange.answer },
											],
										},
									]),
									{
										role: "user",
										content: [{ _tag: "text", text: input.text }],
									},
								],
							};
							const validated = validateRequest(profile, request);
							if (Either.isLeft(validated))
								return yield* validated.left.reason === "capability"
									? new AiCapabilityUnsupported(validated.left.capability)
									: new AiConfigInvalid();
							const prepared = prepareWorkflow(profile, validated.right);
							if (Either.isLeft(prepared)) return yield* prepared.left;
							const acceptedAt = yield* Clock.currentTimeNanos;
							const selection = selectionOf(input);
							const view = emptyTurn(input.sessionId, input.turnId);
							const saved: SavedTurn = {
								selection,
								input: input.text,
								...(input.systemPrompt === undefined
									? {}
									: { systemPrompt: input.systemPrompt }),
								contextEpoch: history.contextEpoch,
								snapshot: view,
								status: "processing",
							};
							const next = {
								...history,
								revision: history.revision + 1,
								updatedAt: now,
								turns: [...history.turns, saved],
							};
							yield* repository.put(next, history.revision);
							repaired(next);
							const turn: ActiveTurn = {
								owner,
								selection,
								acceptedAt,
								outputReserve,
								inputTokens: request.messages.reduce(
									(sum, message) =>
										sum +
										message.content.reduce(
											(count, part) =>
												count +
												(part._tag === "text"
													? estimatedTextTokens(part.text)
													: 0),
											0,
										),
									0,
								),
								stop: yield* Deferred.make<Terminal>(),
								done: yield* Deferred.make<void>(),
								subscribers: new Set(),
								view,
								session: reduceSession(
									{
										...emptySession(input.sessionId),
										hasCompletedExchange: history.turns.some(
											(item) =>
												item.contextEpoch === history.contextEpoch &&
												item.status === "completed",
										),
									},
									{
										type: "accept",
										sessionId: input.sessionId,
										turnId: input.turnId,
									},
								),
								history: next,
								generation: Option.none(),
								usage: Option.none(),
								checkpointAt: now,
								checkpointBytes: 0,
								checkpointSeq: -1,
							};
							active.set(id, turn);
							const subscription = yield* attach(turn);
							yield* Effect.forkIn(
								run(turn, profile, request).pipe(Effect.interruptible),
								scope,
							);
							return { ...subscription, selection };
						}).pipe(Effect.uninterruptible),
					),
			);
			const cancel = Effect.fn("ChatService.cancel")(function* (
				owner: string,
				sessionId: SessionId,
				turnId: TurnId,
			): Effect.fn.Return<void, ChatError> {
				const current = active.get(key(owner, sessionId));
				if (!current || current.selection.turnId !== turnId) {
					const history = yield* read(owner, sessionId);
					if (!history.turns.some((item) => item.selection.turnId === turnId))
						return yield* new ChatNotFound();
					return;
				}
				// Abort immediately; an in-flight atomic history save may still own the state lock.
				yield* Deferred.succeed(current.stop, { outcome: "cancelled" });
				if (Option.isSome(current.generation))
					yield* current.generation.value.cancel();
				yield* Deferred.await(current.done);
			});
			const stopSession = (
				owner: string,
				sessionId: SessionId,
			): Effect.Effect<void, ChatError> =>
				Effect.gen(function* () {
					const turn = active.get(key(owner, sessionId));
					if (turn) yield* cancel(owner, sessionId, turn.selection.turnId);
				});
			const close = Effect.fn("ChatService.close")(function* (
				owner: string,
				sessionId: SessionId,
			): Effect.fn.Return<void, ChatError> {
				yield* stopSession(owner, sessionId);
				yield* lock.withPermits(1)(
					Effect.gen(function* () {
						if (active.has(key(owner, sessionId))) return yield* new ChatBusy();
						const history = yield* read(owner, sessionId);
						yield* repository.put(
							{
								...history,
								revision: history.revision + 1,
								contextEpoch: history.contextEpoch + 1,
							},
							history.revision,
						);
						repaired(history);
					}),
				);
			});
			const clear = Effect.fn("ChatService.clear")(function* (
				owner: string,
				sessionId: SessionId,
			): Effect.fn.Return<void, ChatError> {
				yield* stopSession(owner, sessionId);
				yield* lock.withPermits(1)(
					Effect.gen(function* () {
						if (active.has(key(owner, sessionId))) return yield* new ChatBusy();
						yield* repository.remove(owner, sessionId);
						for (const [id, snapshot] of unsavedTerminals)
							if (
								snapshot.sessionId === sessionId &&
								id === turnKey(owner, sessionId, snapshot.turnId)
							)
								unsavedTerminals.delete(id);
					}),
				);
			});
			const snapshot = Effect.fn("ChatService.snapshot")(function* (
				owner: string,
				sessionId: SessionId,
				turnId: TurnId,
			): Effect.fn.Return<TurnSnapshot, ChatError> {
				return yield* lock.withPermits(1)(
					Effect.gen(function* () {
						const turn = active.get(key(owner, sessionId));
						if (turn?.selection.turnId === turnId) return turn.view;
						const history = yield* read(owner, sessionId);
						const saved = history.turns.find(
							(item) => item.selection.turnId === turnId,
						);
						if (!saved) return yield* new ChatNotFound();
						return saved.snapshot;
					}),
				);
			});
			const subscribe = Effect.fn("ChatService.subscribe")(
				(
					owner: string,
					sessionId: SessionId,
					turnId: TurnId,
				): Effect.Effect<ChatSubscription, ChatError> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							const turn = active.get(key(owner, sessionId));
							if (turn?.selection.turnId === turnId) return yield* attach(turn);
							const history = yield* read(owner, sessionId);
							const saved = history.turns.find(
								(item) => item.selection.turnId === turnId,
							);
							if (!saved) return yield* new ChatNotFound();
							return { snapshot: saved.snapshot, events: Stream.empty };
						}),
					),
			);
			const session = Effect.fn("ChatService.session")(
				(
					owner: string,
					sessionId: SessionId,
				): Effect.Effect<Session, ChatError> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							const turn = active.get(key(owner, sessionId));
							if (turn) return turn.session;
							const history = yield* read(owner, sessionId);
							const now = yield* Clock.currentTimeMillis;
							const completed =
								now - history.updatedAt < idleMs &&
								history.turns.some(
									(item) =>
										item.contextEpoch === history.contextEpoch &&
										item.status === "completed",
								);
							return {
								...emptySession(sessionId),
								state: completed ? "IDLE" : "EMPTY",
								hasCompletedExchange: completed,
							};
						}),
					),
			);
			const rename = Effect.fn("ChatService.rename")(
				(
					owner: string,
					sessionId: SessionId,
					title: string,
				): Effect.Effect<void, ChatError> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							if (!title.trim() || title.length > 256)
								return yield* new ChatInvalid();
							if (active.has(key(owner, sessionId)))
								return yield* new ChatBusy();
							const history = yield* read(owner, sessionId);
							yield* repository.put(
								{
									...history,
									revision: history.revision + 1,
									title,
									manualTitle: true,
								},
								history.revision,
							);
							repaired(history);
						}),
					),
			);
			const supersede = Effect.fn("ChatService.supersede")(function* (
				owner: string,
				input: ChatSubmit,
			): Effect.fn.Return<ChatTurn, ChatError | AiError> {
				yield* stopSession(owner, input.sessionId);
				return yield* submit(owner, input);
			});
			yield* Effect.addFinalizer(() =>
				Effect.forEach(
					[...active.values()],
					(turn) =>
						Deferred.succeed(turn.stop, { outcome: "cancelled" }).pipe(
							Effect.zipRight(
								Option.isSome(turn.generation)
									? turn.generation.value.cancel()
									: Effect.void,
							),
							Effect.zipRight(Deferred.await(turn.done)),
						),
					{ concurrency: "unbounded", discard: true },
				),
			);
			return {
				submit,
				supersede,
				cancel,
				close,
				clear,
				snapshot,
				subscribe,
				session,
				rename,
				history: Effect.fn("ChatService.history")(
					(
						owner: string,
						sessionId: SessionId,
					): Effect.Effect<ChatHistory, ChatError> => read(owner, sessionId),
				),
				list: Effect.fn("ChatService.list")(
					(owner: string): Effect.Effect<readonly ChatHistory[]> =>
						repository
							.list(owner)
							.pipe(Effect.map((histories) => histories.map(present))),
				),
			};
		}),
	},
) {}
