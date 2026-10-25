import type { Redacted } from "effect";
import { Cause, Context, Deferred, Effect, Exit, Schema, Stream } from "effect";
import {
	ConversationRepository,
	ConversationScope,
	ConversationStart,
} from "./conversation-repository.js";
import {
	type RuntimeConnection,
	RuntimeConversationEvent,
	type RuntimeConversationRequest,
} from "./runtime-contracts.js";
import {
	RuntimeConnectionInvalid,
	type RuntimeError,
	RuntimeLimitExceeded,
	RuntimeProtocolInvalid,
	RuntimeRequestFailed,
} from "./runtime-errors.js";
import type { RuntimeProviderAdapter } from "./runtime-ports.js";

export interface ConversationResolution {
	readonly connection: RuntimeConnection;
	readonly credential?: Redacted.Redacted<string>;
	/** Adapter is already bound to this connection's credential by the resolver. */
	readonly adapter: RuntimeProviderAdapter;
}
export type ConversationResolver = (
	connectionId: string,
) => Effect.Effect<ConversationResolution, RuntimeError>;
export class ConversationRuntimePort extends Context.Tag(
	"ConversationRuntimePort",
)<ConversationRuntimePort, { readonly resolve: ConversationResolver }>() {}
const identity = {
	connectionId: ConversationStart.fields.connectionId,
	agentId: ConversationStart.fields.agentId,
	sessionId: ConversationStart.fields.requestId,
	requestId: ConversationStart.fields.requestId,
	seq: Schema.Int.pipe(Schema.nonNegative()),
};
export const ConversationEvent = Schema.Union(
	Schema.Struct({
		...identity,
		type: Schema.Literal("provider"),
		event: RuntimeConversationEvent,
	}),
	Schema.Struct({
		...identity,
		type: Schema.Literal("end"),
		outcome: Schema.Literal("completed", "cancelled", "failed"),
		errorCode: Schema.optional(Schema.String),
		message: Schema.optional(Schema.String),
	}),
);
export type ConversationEvent = typeof ConversationEvent.Type;
interface ActiveConversation {
	readonly owner: string;
	readonly input: ConversationStart;
	readonly cancel: Deferred.Deferred<void>;
	readonly finished: Deferred.Deferred<void>;
	cancelled: boolean;
}

export class ConversationService extends Effect.Service<ConversationService>()(
	"ConversationService",
	{
		accessors: true,
		dependencies: [ConversationRepository.Default],
		effect: Effect.gen(function* () {
			const repository = yield* ConversationRepository;
			const resolver = yield* ConversationRuntimePort;
			const active = new Map<string, ActiveConversation>();
			let closed = false;
			const key = (owner: string, requestId: string): string =>
				JSON.stringify([owner, requestId]);
			const stream = (
				owner: string,
				raw: unknown,
			): Stream.Stream<ConversationEvent, RuntimeError> =>
				Stream.unwrapScoped(
					Effect.gen(function* () {
						const input = yield* Schema.decodeUnknown(ConversationStart)(raw, {
							onExcessProperty: "error",
						}).pipe(
							Effect.catchTag("ParseError", (cause) =>
								Effect.fail(new RuntimeConnectionInvalid(cause)),
							),
						);
						if (!owner || closed) return yield* new RuntimeRequestFailed();
						const id = key(owner, input.requestId);
						if (active.has(id)) return yield* new RuntimeRequestFailed();
						if (
							active.size >= 16 ||
							[...active.values()].filter((entry) => entry.owner === owner)
								.length >= 4
						)
							return yield* new RuntimeLimitExceeded();
						const state: ActiveConversation = {
							owner,
							input,
							cancel: yield* Deferred.make<void>(),
							finished: yield* Deferred.make<void>(),
							cancelled: false,
						};
						active.set(id, state);
						const scope = {
							connectionId: input.connectionId,
							...(input.agentId === undefined
								? {}
								: { agentId: input.agentId }),
							sessionId: input.sessionId ?? input.requestId,
						};
						let seq = 0;
						let begun = false;
						let completed = false;
						let remoteSessionId: string | undefined;
						let failure: RuntimeError | undefined;
						let eventCount = 0;
						const envelope = () => ({
							...scope,
							requestId: input.requestId,
							seq: seq++,
						});
						yield* Effect.addFinalizer((exit) => {
							if (Exit.isFailure(exit) && Cause.isInterrupted(exit.cause))
								state.cancelled = true;
							return (
								begun
									? repository.finish(
											owner,
											scope,
											input.requestId,
											state.cancelled
												? "cancelled"
												: completed && !failure
													? "completed"
													: "failed",
											remoteSessionId,
										)
									: Effect.void
							).pipe(
								Effect.zipRight(Effect.sync(() => active.delete(id))),
								Effect.zipRight(Deferred.succeed(state.finished, undefined)),
							);
						});
						const provider = Stream.unwrap(
							Effect.gen(function* () {
								const resolved = yield* resolver.resolve(input.connectionId);
								if (
									resolved.connection.id !== input.connectionId ||
									resolved.adapter.kind !== resolved.connection.kind
								)
									return yield* new RuntimeConnectionInvalid();
								const binding = JSON.stringify([
									resolved.connection.kind,
									resolved.connection.baseURL,
									resolved.connection.credentialRef ?? null,
									input.modelId ?? null,
								]);
								const session = yield* repository.begin(owner, input, binding);
								begun = true;
								let messages = [...session.messages];
								while (
									messages.length > 1 &&
									messages.reduce(
										(sum, message) => sum + message.content.length,
										0,
									) > 262144
								)
									messages = messages.slice(2);
								const request: RuntimeConversationRequest = {
									connectionId: input.connectionId,
									conversationId: input.requestId,
									messages,
									...(input.agentId === undefined
										? {}
										: { agentId: input.agentId }),
									...(input.modelId === undefined
										? {}
										: { modelId: input.modelId }),
									...(session.remoteSessionId === undefined
										? {}
										: { sessionId: session.remoteSessionId }),
								};
								return resolved.adapter
									.streamConversation(resolved.connection, request)
									.pipe(
										Stream.mapEffect((rawEvent) =>
											Effect.gen(function* () {
												if (completed)
													return yield* new RuntimeProtocolInvalid();
												if (
													++eventCount > 8192 ||
													JSON.stringify(rawEvent).length > 65536
												)
													return yield* new RuntimeLimitExceeded();
												const event = yield* Schema.decodeUnknown(
													RuntimeConversationEvent,
												)(rawEvent, { onExcessProperty: "error" }).pipe(
													Effect.catchTag("ParseError", (cause) =>
														Effect.fail(new RuntimeProtocolInvalid(cause)),
													),
												);
												if (event._tag === "textDelta")
													yield* repository.append(
														owner,
														scope,
														input.requestId,
														event.textDelta,
													);
												if (
													(event._tag === "status" ||
														event._tag === "completed") &&
													event.sessionId !== undefined
												)
													remoteSessionId = event.sessionId;
												if (event._tag === "completed") completed = true;
												return {
													...envelope(),
													type: "provider" as const,
													event,
												};
											}),
										),
									);
							}),
						).pipe(
							Stream.interruptWhenDeferred(state.cancel),
							Stream.catchAll((error) => {
								failure = error;
								return Stream.empty;
							}),
						);
						return provider.pipe(
							Stream.concat(
								Stream.fromEffect(
									Effect.sync((): ConversationEvent => {
										if (!state.cancelled && !completed && !failure)
											failure = new RuntimeProtocolInvalid();
										return {
											...envelope(),
											type: "end",
											outcome: state.cancelled
												? "cancelled"
												: failure
													? "failed"
													: "completed",
											...(failure
												? { errorCode: failure.code, message: failure.message }
												: {}),
										};
									}),
								),
							),
						);
					}),
				).pipe(Stream.withSpan("ConversationService.stream"));
			const cancel = Effect.fn("ConversationService.cancel")(function* (
				owner: string,
				requestId: string,
			): Effect.fn.Return<void> {
				const state = active.get(key(owner, requestId));
				if (!state) return;
				state.cancelled = true;
				yield* Deferred.succeed(state.cancel, undefined);
				yield* Deferred.await(state.finished);
			});
			const cancelOwner = Effect.fn("ConversationService.cancelOwner")(
				function* (owner: string): Effect.fn.Return<void> {
					const states = [...active.values()].filter(
						(entry) => entry.owner === owner,
					);
					for (const state of states) {
						state.cancelled = true;
						yield* Deferred.succeed(state.cancel, undefined);
					}
					yield* Effect.forEach(
						states,
						(state) => Deferred.await(state.finished),
						{ discard: true },
					);
				},
			);
			const history = Effect.fn("ConversationService.history")(function* (
				owner: string,
				raw: unknown,
			): Effect.fn.Return<
				readonly import("./conversation-repository.js").ConversationHistory[],
				RuntimeError
			> {
				const scope = yield* Schema.decodeUnknown(ConversationScope)(raw, {
					onExcessProperty: "error",
				}).pipe(
					Effect.catchTag("ParseError", (cause) =>
						Effect.fail(new RuntimeConnectionInvalid(cause)),
					),
				);
				return yield* repository.history(owner, scope);
			});
			const clear = Effect.fn("ConversationService.clear")(function* (
				owner: string,
				raw: unknown,
			): Effect.fn.Return<void, RuntimeError> {
				const scope = yield* Schema.decodeUnknown(ConversationScope)(raw, {
					onExcessProperty: "error",
				}).pipe(
					Effect.catchTag("ParseError", (cause) =>
						Effect.fail(new RuntimeConnectionInvalid(cause)),
					),
				);
				return yield* repository.clear(owner, scope);
			});
			const shutdown = Effect.fn("ConversationService.shutdown")(
				function* (): Effect.fn.Return<void> {
					closed = true;
					yield* Effect.forEach(
						[...new Set([...active.values()].map((entry) => entry.owner))],
						cancelOwner,
						{ discard: true },
					);
				},
			);
			return { stream, cancel, cancelOwner, history, clear, shutdown };
		}),
	},
) {}
