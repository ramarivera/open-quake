import { Option } from "effect";
import type {
	ChatChunk,
	Outcome,
	Session,
	SessionId,
	Terminal,
	TurnId,
	TurnSnapshot,
} from "./chat-contracts.js";

export interface TurnView extends TurnSnapshot {
	readonly needsSnapshot: boolean;
}
export const emptyTurn = (sessionId: SessionId, turnId: TurnId): TurnView => ({
	sessionId,
	turnId,
	lastSeq: -1,
	text: "",
	suggestions: [],
	terminal: Option.none(),
	needsSnapshot: false,
});

/** Total reducer: gaps pause application until an authoritative snapshot arrives. */
export function reduceChunk(state: TurnView, chunk: ChatChunk): TurnView {
	if (
		chunk.sessionId !== state.sessionId ||
		chunk.turnId !== state.turnId ||
		Option.isSome(state.terminal) ||
		chunk.seq <= state.lastSeq
	)
		return state;
	if (state.needsSnapshot) return state;
	if (chunk.seq !== state.lastSeq + 1) return { ...state, needsSnapshot: true };
	switch (chunk.type) {
		case "answer":
			return {
				...state,
				lastSeq: chunk.seq,
				text: state.text + chunk.textDelta,
			};
		case "followUp":
			return {
				...state,
				lastSeq: chunk.seq,
				suggestions: [
					...state.suggestions.filter(
						(item) => item.suggestionId !== chunk.suggestionId,
					),
					{ suggestionId: chunk.suggestionId, text: chunk.text },
				],
			};
		case "end": {
			const terminal: Terminal = {
				outcome: chunk.outcome,
				...(chunk.errorCode === undefined
					? {}
					: { errorCode: chunk.errorCode }),
				...(chunk.usage === undefined ? {} : { usage: chunk.usage }),
			};
			return { ...state, lastSeq: chunk.seq, terminal: Option.some(terminal) };
		}
	}
}

export function restoreSnapshot(
	state: TurnView,
	snapshot: TurnSnapshot,
): TurnView {
	if (
		snapshot.sessionId !== state.sessionId ||
		snapshot.turnId !== state.turnId ||
		snapshot.lastSeq < state.lastSeq ||
		Option.isSome(state.terminal)
	)
		return state;
	return { ...snapshot, needsSnapshot: false };
}

export type SessionAction =
	| {
			readonly type: "accept";
			readonly sessionId: SessionId;
			readonly turnId: TurnId;
	  }
	| {
			readonly type: "dispatch";
			readonly sessionId: SessionId;
			readonly turnId: TurnId;
	  }
	| {
			readonly type: "finish";
			readonly sessionId: SessionId;
			readonly turnId: TurnId;
			readonly outcome: Outcome;
	  }
	| { readonly type: "close"; readonly sessionId: SessionId };

export const emptySession = (sessionId: SessionId): Session => ({
	sessionId,
	state: "EMPTY",
	activeTurn: Option.none(),
	hasCompletedExchange: false,
});

/** Busy submits are ignored here; ChatService maps acceptance failures to its catalog. */
export function reduceSession(
	session: Session,
	action: SessionAction,
): Session {
	if (session.sessionId !== action.sessionId) return session;
	if (action.type === "close") return emptySession(session.sessionId);
	if (action.type === "accept") {
		return Option.isSome(session.activeTurn)
			? session
			: {
					...session,
					state: "ONGOING",
					activeTurn: Option.some(action.turnId),
				};
	}
	if (
		Option.isNone(session.activeTurn) ||
		session.activeTurn.value !== action.turnId
	)
		return session;
	if (action.type === "dispatch")
		return session.state === "ONGOING"
			? { ...session, state: "PROCESSING" }
			: session;
	if (action.outcome === "completed" && session.state !== "PROCESSING")
		return session;
	const hasCompletedExchange =
		session.hasCompletedExchange || action.outcome === "completed";
	return {
		...session,
		hasCompletedExchange,
		state: hasCompletedExchange ? "IDLE" : "EMPTY",
		activeTurn: Option.none(),
	};
}
