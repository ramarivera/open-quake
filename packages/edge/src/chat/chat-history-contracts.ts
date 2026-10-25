import { Schema } from "effect";
import { TurnSelection, TurnSnapshot } from "./chat-contracts.js";
export const SavedTurn = Schema.Struct({
	selection: TurnSelection,
	input: Schema.String,
	systemPrompt: Schema.optional(Schema.String),
	contextEpoch: Schema.Int.pipe(Schema.nonNegative()),
	snapshot: TurnSnapshot,
	status: Schema.Literal(
		"processing",
		"completed",
		"cancelled",
		"failed",
		"timedOut",
		"interrupted",
	),
});
export type SavedTurn = typeof SavedTurn.Type;
export const ChatHistory = Schema.Struct({
	owner: Schema.NonEmptyString,
	sessionId: TurnSelection.fields.sessionId,
	title: Schema.String,
	manualTitle: Schema.Boolean,
	revision: Schema.Int.pipe(Schema.nonNegative()),
	contextEpoch: Schema.Int.pipe(Schema.nonNegative()),
	updatedAt: Schema.Number,
	turns: Schema.Array(SavedTurn),
});
export type ChatHistory = typeof ChatHistory.Type;
