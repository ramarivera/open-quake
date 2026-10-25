import { Effect, Schema } from "effect";
import type { RuntimeMessage } from "./runtime-contracts.js";
import {
	RuntimeConnectionInvalid,
	type RuntimeError,
	RuntimeLimitExceeded,
	RuntimeRequestFailed,
} from "./runtime-errors.js";

const Identifier = Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(256));
export const ConversationScope = Schema.Struct({
	connectionId: Identifier,
	agentId: Schema.optional(Identifier),
	sessionId: Schema.optional(Identifier),
});
export type ConversationScope = typeof ConversationScope.Type;
export const ConversationStart = Schema.Struct({
	...ConversationScope.fields,
	requestId: Identifier,
	text: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(32768)),
	modelId: Schema.optional(Identifier),
});
export type ConversationStart = typeof ConversationStart.Type;
export const ConversationOutcome = Schema.Literal(
	"processing",
	"completed",
	"cancelled",
	"failed",
);
export const ConversationTurn = Schema.Struct({
	requestId: Identifier,
	text: Schema.String,
	answer: Schema.String,
	outcome: ConversationOutcome,
});
export type ConversationTurn = typeof ConversationTurn.Type;
export const ConversationHistory = Schema.Struct({
	connectionId: Identifier,
	agentId: Schema.optional(Identifier),
	sessionId: Identifier,
	turns: Schema.Array(ConversationTurn),
});
export type ConversationHistory = typeof ConversationHistory.Type;
interface StoredSession {
	readonly owner: string;
	readonly binding: string;
	view: ConversationHistory;
	remoteSessionId?: string;
	active: boolean;
}
const scopeKey = (owner: string, scope: ConversationScope): string =>
	JSON.stringify([
		owner,
		scope.connectionId,
		scope.agentId ?? null,
		scope.sessionId,
	]);
const matches = (
	owner: string,
	scope: ConversationScope,
	session: StoredSession,
): boolean =>
	session.owner === owner &&
	session.view.connectionId === scope.connectionId &&
	session.view.agentId === scope.agentId &&
	(scope.sessionId === undefined || session.view.sessionId === scope.sessionId);

/** Ephemeral, bounded history. Explicit clear also forgets the private provider session ID. */
export class ConversationRepository extends Effect.Service<ConversationRepository>()(
	"ConversationRepository",
	{
		accessors: true,
		sync: () => {
			const sessions = new Map<string, StoredSession>();
			const seen = new Set<string>();
			const begin = Effect.fn("ConversationRepository.begin")(function* (
				owner: string,
				input: ConversationStart,
				binding: string,
			): Effect.fn.Return<
				{
					history: ConversationHistory;
					messages: readonly RuntimeMessage[];
					remoteSessionId?: string;
				},
				RuntimeError
			> {
				const requestKey = JSON.stringify([owner, input.requestId]);
				if (seen.has(requestKey)) return yield* new RuntimeRequestFailed();
				if (seen.size >= 4096) return yield* new RuntimeLimitExceeded();
				const sessionId = input.sessionId ?? input.requestId;
				const key = scopeKey(owner, { ...input, sessionId });
				let session = sessions.get(key);
				if (
					input.sessionId !== undefined &&
					(!session || session.binding !== binding)
				)
					return yield* new RuntimeConnectionInvalid();
				if (session?.active) return yield* new RuntimeRequestFailed();
				if (!session) {
					if (sessions.size >= 64) {
						const oldest = [...sessions].find(([, value]) => !value.active);
						if (!oldest) return yield* new RuntimeLimitExceeded();
						sessions.delete(oldest[0]);
					}
					session = {
						owner,
						binding,
						active: false,
						view: {
							connectionId: input.connectionId,
							...(input.agentId === undefined
								? {}
								: { agentId: input.agentId }),
							sessionId,
							turns: [],
						},
					};
					sessions.set(key, session);
				}
				seen.add(requestKey);
				// Failed or cancelled partial answers aren't replayed as successful assistant history.
				const messages: RuntimeMessage[] = session.view.turns
					.filter((turn) => turn.outcome === "completed")
					.flatMap((turn) => [
						{ role: "user" as const, content: turn.text },
						{ role: "assistant" as const, content: turn.answer },
					]);
				messages.push({ role: "user", content: input.text });
				session.active = true;
				session.view = {
					...session.view,
					turns: [
						...session.view.turns.slice(-31),
						{
							requestId: input.requestId,
							text: input.text,
							answer: "",
							outcome: "processing",
						},
					],
				};
				return {
					history: session.view,
					messages,
					...(session.remoteSessionId === undefined
						? {}
						: { remoteSessionId: session.remoteSessionId }),
				};
			});
			const append = Effect.fn("ConversationRepository.append")(function* (
				owner: string,
				scope: ConversationScope,
				requestId: string,
				delta: string,
			): Effect.fn.Return<void, RuntimeError> {
				const session = sessions.get(scopeKey(owner, scope));
				if (!session?.active) return yield* new RuntimeConnectionInvalid();
				const turn = session.view.turns.find(
					(item) => item.requestId === requestId,
				);
				if (!turn) return yield* new RuntimeConnectionInvalid();
				if (turn.answer.length + delta.length > 65536)
					return yield* new RuntimeLimitExceeded();
				session.view = {
					...session.view,
					turns: session.view.turns.map((item) =>
						item.requestId === requestId
							? { ...item, answer: item.answer + delta }
							: item,
					),
				};
			});
			const finish = Effect.fn("ConversationRepository.finish")(
				(
					owner: string,
					scope: ConversationScope,
					requestId: string,
					outcome: "completed" | "cancelled" | "failed",
					remoteSessionId?: string,
				): Effect.Effect<void> =>
					Effect.sync(() => {
						const session = sessions.get(scopeKey(owner, scope));
						if (!session) return;
						session.active = false;
						if (remoteSessionId !== undefined)
							session.remoteSessionId = remoteSessionId;
						let turns = session.view.turns.map((turn) =>
							turn.requestId === requestId ? { ...turn, outcome } : turn,
						);
						while (
							turns.length > 1 &&
							turns.reduce(
								(sum, turn) => sum + turn.text.length + turn.answer.length,
								0,
							) > 262144
						)
							turns = turns.slice(1);
						session.view = { ...session.view, turns };
					}),
			);
			const history = Effect.fn("ConversationRepository.history")(
				(
					owner: string,
					scope: ConversationScope,
				): Effect.Effect<readonly ConversationHistory[]> =>
					Effect.sync(() =>
						[...sessions.values()]
							.filter((session) => matches(owner, scope, session))
							.map((session) => session.view),
					),
			);
			const clear = Effect.fn("ConversationRepository.clear")(function* (
				owner: string,
				scope: ConversationScope,
			): Effect.fn.Return<void, RuntimeError> {
				const matching = [...sessions].filter(([, session]) =>
					matches(owner, scope, session),
				);
				if (matching.some(([, session]) => session.active))
					return yield* new RuntimeRequestFailed();
				for (const [key] of matching) sessions.delete(key);
			});
			return { begin, append, finish, history, clear };
		},
	},
) {}
