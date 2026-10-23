import * as Schema from "effect/Schema";
import { ProfileId, Usage } from "../ai/ai-contracts.js";

export const SessionId = Schema.UUID.pipe(Schema.brand("ChatSessionId"));
export type SessionId = typeof SessionId.Type;
export const TurnId = Schema.UUID.pipe(Schema.brand("ChatTurnId"));
export type TurnId = typeof TurnId.Type;
export const Outcome = Schema.Literal(
	"completed",
	"cancelled",
	"failed",
	"timedOut",
);
export type Outcome = typeof Outcome.Type;
const Sequence = Schema.Int.pipe(Schema.nonNegative());
const identity = { sessionId: SessionId, turnId: TurnId };
const envelope = { version: Schema.Literal(1), ...identity, seq: Sequence };
export const TurnSelection = Schema.Struct({
	...identity,
	profileId: ProfileId,
	modelId: Schema.NonEmptyString,
	mode: Schema.Literal(
		"normal",
		"keyConfig",
		"operatePC",
		"operateEquipment",
		"pictureGeneration",
		"dataAnalysis",
		"videoGeneration",
	),
	authGeneration: Sequence,
});
export type TurnSelection = typeof TurnSelection.Type;
export const Suggestion = Schema.Struct({
	suggestionId: Schema.NonEmptyString,
	text: Schema.String,
});
export const Terminal = Schema.Struct({
	outcome: Outcome,
	errorCode: Schema.optional(
		Schema.String.pipe(Schema.pattern(/^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)+$/)),
	),
	usage: Schema.optional(Usage),
});
export type Terminal = typeof Terminal.Type;
export const ChatChunk = Schema.Union(
	Schema.Struct({
		...envelope,
		type: Schema.Literal("answer"),
		textDelta: Schema.String,
	}),
	Schema.Struct({
		...envelope,
		type: Schema.Literal("followUp"),
		...Suggestion.fields,
	}),
	Schema.Struct({
		...envelope,
		type: Schema.Literal("end"),
		...Terminal.fields,
	}),
);
export type ChatChunk = typeof ChatChunk.Type;
export const TurnSnapshot = Schema.Struct({
	...identity,
	lastSeq: Schema.Int.pipe(Schema.greaterThanOrEqualTo(-1)),
	text: Schema.String,
	suggestions: Schema.Array(Suggestion),
	terminal: Schema.OptionFromNullOr(Terminal),
});
export type TurnSnapshot = typeof TurnSnapshot.Type;
export const SessionState = Schema.Literal(
	"EMPTY",
	"ONGOING",
	"PROCESSING",
	"IDLE",
);
export type SessionState = typeof SessionState.Type;
export const Session = Schema.Struct({
	sessionId: SessionId,
	state: SessionState,
	activeTurn: Schema.OptionFromNullOr(TurnId),
	hasCompletedExchange: Schema.Boolean,
});
export type Session = typeof Session.Type;
