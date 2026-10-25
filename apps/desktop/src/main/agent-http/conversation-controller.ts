import {
	Deferred,
	Effect,
	Fiber,
	type ManagedRuntime,
	Schema,
	Stream,
} from "effect";
import {
	type ConversationEvent,
	ConversationService,
} from "../../../../../packages/edge/src/agent-http/conversation-service.js";
import { RuntimeTimeout } from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import {
	ConversationCommand,
	type ConversationReply,
} from "../../shared/agent-conversations.js";
import {
	type AgentsAuthority,
	agentRequestAllowed,
} from "../agents/controller.js";
import type { DesktopDiagnostics } from "../diagnostics";

export interface ConversationControllerOptions {
	readonly diagnostics?: DesktopDiagnostics;
	readonly runtime: ManagedRuntime.ManagedRuntime<ConversationService, never>;
	readonly managementId: () => number | undefined;
	readonly renderer: string;
	readonly send: (source: AgentsAuthority, event: ConversationEvent) => boolean;
	readonly acknowledgementTimeoutMs?: number;
}
export function createConversationController(
	options: ConversationControllerOptions,
) {
	const observe = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		options.diagnostics
			? options.diagnostics.instrument(effect, "agent.conversation")
			: effect;
	const running = new Map<
		string,
		{ owner: string; fiber: Fiber.RuntimeFiber<void, never> }
	>();
	const acknowledgements = new Map<
		string,
		{ seq: number; ready: Deferred.Deferred<void> }
	>();
	let disposed = false;
	const ownerOf = (source: AgentsAuthority): string =>
		`management:${source.senderId}`;
	const key = (owner: string, requestId: string): string =>
		JSON.stringify([owner, requestId]);
	const rejected = (code: string, message: string): ConversationReply => ({
		_tag: "rejected",
		code,
		message,
	});
	const stopOwner = (owner: string): Promise<void> =>
		options.runtime.runPromise(
			Effect.forEach(
				[...running.values()].filter((work) => work.owner === owner),
				(work) => Fiber.interrupt(work.fiber),
				{ discard: true },
			),
		);
	const handle = async (
		source: AgentsAuthority,
		raw: unknown,
	): Promise<ConversationReply> => {
		if (!agentRequestAllowed(source, options.managementId(), options.renderer))
			return rejected(
				"AGENT.HTTP.IPC.UNAUTHORIZED",
				"Unauthorized conversation request",
			);
		if (disposed)
			return rejected("AGENT.HTTP.IPC.DISPOSED", "Conversations are closed");
		const decoded = Schema.decodeUnknownEither(ConversationCommand)(raw, {
			onExcessProperty: "error",
		});
		if (decoded._tag === "Left")
			return rejected(
				"AGENT.HTTP.CONNECTION.INVALID",
				"The conversation request is invalid",
			);
		const command = decoded.right;
		const owner = ownerOf(source);
		if (command.type === "ack") {
			const ack = acknowledgements.get(key(owner, command.requestId));
			if (ack?.seq === command.seq)
				await options.runtime.runPromise(
					Deferred.succeed(ack.ready, undefined),
				);
			return { _tag: "success", history: [] };
		}
		if (command.type === "cancel") {
			const work = running.get(key(owner, command.requestId));
			if (work) await options.runtime.runPromise(Fiber.interrupt(work.fiber));
			return { _tag: "success", history: [] };
		}
		if (command.type === "unsubscribe") {
			await stopOwner(owner);
			return { _tag: "success", history: [] };
		}
		if (command.type === "start") {
			const id = key(owner, command.requestId);
			if (
				running.has(id) ||
				running.size >= 16 ||
				[...running.values()].filter((work) => work.owner === owner).length >= 4
			)
				return rejected(
					"AGENT.HTTP.REQUEST.FAILED",
					"A conversation is already running or the limit was reached",
				);
			const { type: _type, ...input } = command;
			const deliver = (event: ConversationEvent) =>
				Effect.gen(function* () {
					const ready = yield* Deferred.make<void>();
					acknowledgements.set(id, { seq: event.seq, ready });
					if (
						!agentRequestAllowed(
							source,
							options.managementId(),
							options.renderer,
						) ||
						!options.send(source, event)
					)
						return yield* Effect.interrupt;
					yield* Deferred.await(ready).pipe(
						Effect.timeoutFail({
							duration: options.acknowledgementTimeoutMs ?? 15000,
							onTimeout: () => new RuntimeTimeout(),
						}),
					);
				});
			const fiber = options.runtime.runFork(
				Effect.gen(function* () {
					const service = yield* ConversationService;
					yield* service.stream(owner, input).pipe(
						Stream.runForEach(deliver),
						observe,
						Effect.catchAll((error) =>
							Effect.sync(() => {
								if (
									agentRequestAllowed(
										source,
										options.managementId(),
										options.renderer,
									)
								)
									options.send(source, {
										connectionId: input.connectionId,
										...(input.agentId === undefined
											? {}
											: { agentId: input.agentId }),
										sessionId: input.sessionId ?? input.requestId,
										requestId: input.requestId,
										seq: (acknowledgements.get(id)?.seq ?? -1) + 1,
										type: "end",
										outcome: "failed",
										errorCode: error.code,
										message: error.message,
									});
							}),
						),
					);
				}).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							running.delete(id);
							acknowledgements.delete(id);
						}),
					),
				),
			);
			running.set(id, { owner, fiber });
			return {
				_tag: "success",
				requestId: input.requestId,
				sessionId: input.sessionId ?? input.requestId,
				history: [],
			};
		}
		const { type, ...scope } = command;
		return options.runtime.runPromise(
			Effect.gen(function* () {
				const service = yield* ConversationService;
				if (type === "clear") yield* service.clear(owner, scope);
				return yield* service.history(owner, scope);
			}).pipe(
				observe,
				Effect.match({
					onSuccess: (history): ConversationReply => ({
						_tag: "success",
						history,
					}),
					onFailure: (error): ConversationReply =>
						rejected(error.code, error.message),
				}),
			),
		);
	};
	return {
		handle,
		cancelOwner: (senderId: number): Promise<void> =>
			stopOwner(`management:${senderId}`),
		dispose: async (): Promise<void> => {
			disposed = true;
			await Promise.all(
				[...new Set([...running.values()].map((work) => work.owner))].map(
					stopOwner,
				),
			);
		},
	};
}
