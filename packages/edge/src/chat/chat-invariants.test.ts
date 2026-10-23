import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import * as fc from "fast-check";
import {
	ChatChunk,
	SessionId,
	TurnId,
	TurnSnapshot,
} from "./chat-contracts.js";
import {
	emptySession,
	emptyTurn,
	reduceChunk,
	reduceSession,
	restoreSnapshot,
} from "./chat-invariants.js";

const sessionId = Schema.decodeUnknownSync(SessionId)(
	"00000000-0000-4000-8000-000000000010",
);
const turnId = Schema.decodeUnknownSync(TurnId)(
	"00000000-0000-4000-8000-000000000011",
);
const otherSession = Schema.decodeUnknownSync(SessionId)(
	"00000000-0000-4000-8000-000000000012",
);
const otherTurn = Schema.decodeUnknownSync(TurnId)(
	"00000000-0000-4000-8000-000000000013",
);
const answer = (seq: number, textDelta: string): ChatChunk => ({
	version: 1,
	sessionId,
	turnId,
	seq,
	type: "answer",
	textDelta,
});
const end = (seq: number): Extract<ChatChunk, { type: "end" }> => ({
	version: 1,
	sessionId,
	turnId,
	seq,
	type: "end",
	outcome: "completed",
});

describe("chat protocol v1", () => {
	it("round-trips events and snapshots with optional usage and stable errors", () => {
		for (const chunk of [
			answer(0, "Hello"),
			{
				version: 1,
				sessionId,
				turnId,
				seq: 1,
				type: "followUp",
				suggestionId: "next",
				text: "more",
			},
			{
				...end(2),
				errorCode: "CHAT.RESPONSE.TIMEOUT",
				usage: { inputTokens: 1, outputTokens: 2, provenance: "estimated" },
			},
		] as const)
			expect(
				Schema.decodeUnknownSync(ChatChunk)(
					Schema.encodeSync(ChatChunk)(chunk),
				),
			).toEqual(chunk);
		const snapshot = reduceChunk(emptyTurn(sessionId, turnId), answer(0, "hi"));
		const { needsSnapshot: _needsSnapshot, ...expected } = snapshot;
		expect(
			Schema.decodeUnknownSync(TurnSnapshot)(
				Schema.encodeSync(TurnSnapshot)(snapshot),
			),
		).toEqual(expected);
	});
	it("concatenates verbatim deltas, ignores duplicates and accepts exactly one end", () => {
		fc.assert(
			fc.property(fc.array(fc.string(), { maxLength: 60 }), (deltas) => {
				let state = emptyTurn(sessionId, turnId);
				deltas.forEach((text, seq) => {
					const chunk = answer(seq, text);
					state = reduceChunk(state, chunk);
					expect(reduceChunk(state, chunk)).toBe(state);
				});
				expect(state.text).toBe(deltas.join(""));
				const completed = reduceChunk(state, end(deltas.length));
				expect(Option.isSome(completed.terminal)).toBe(true);
				expect(reduceChunk(completed, end(deltas.length + 1))).toBe(completed);
				expect(reduceChunk(completed, answer(deltas.length + 1, "late"))).toBe(
					completed,
				);
			}),
		);
	});
	it("keeps complete suggestions separate from answer text", () => {
		let state = reduceChunk(emptyTurn(sessionId, turnId), answer(0, "answer"));
		state = reduceChunk(state, {
			version: 1,
			sessionId,
			turnId,
			seq: 1,
			type: "followUp",
			suggestionId: "next",
			text: "suggestion",
		});
		expect(state.text).toBe("answer");
		expect(state.suggestions).toEqual([
			{ suggestionId: "next", text: "suggestion" },
		]);
	});
	it("pauses at gaps and resumes after an authoritative matching snapshot", () => {
		const initial = reduceChunk(emptyTurn(sessionId, turnId), answer(0, "a"));
		const paused = reduceChunk(initial, answer(2, "c"));
		expect(paused.needsSnapshot).toBe(true);
		expect(reduceChunk(paused, answer(1, "b"))).toBe(paused);
		const snapshot: TurnSnapshot = { ...initial, text: "abc", lastSeq: 2 };
		expect(
			restoreSnapshot(paused, { ...snapshot, sessionId: otherSession }),
		).toBe(paused);
		expect(restoreSnapshot(paused, { ...snapshot, turnId: otherTurn })).toBe(
			paused,
		);
		expect(restoreSnapshot(paused, { ...snapshot, lastSeq: -1 })).toBe(paused);
		const restored = restoreSnapshot(paused, snapshot);
		expect(restored.needsSnapshot).toBe(false);
		expect(reduceChunk(restored, answer(2, "c"))).toBe(restored);
		expect(reduceChunk(restored, answer(3, "d")).text).toBe("abcd");
	});
	it("never mutates another conversation or turn", () => {
		fc.assert(
			fc.property(fc.string(), (text) => {
				const initial = emptyTurn(sessionId, turnId);
				expect(
					reduceChunk(initial, { ...answer(0, text), sessionId: otherSession }),
				).toBe(initial);
				expect(
					reduceChunk(initial, { ...answer(0, text), turnId: otherTurn }),
				).toBe(initial);
			}),
		);
	});
	it("accepts cancellation before the first answer and cannot reopen a completed snapshot", () => {
		const state = reduceChunk(emptyTurn(sessionId, turnId), {
			...end(0),
			outcome: "cancelled",
		});
		expect(Option.getOrThrow(state.terminal).outcome).toBe("cancelled");
		expect(state.lastSeq).toBe(0);
		expect(
			restoreSnapshot(state, { ...state, terminal: Option.none(), lastSeq: 1 }),
		).toBe(state);
	});
});

describe("session reducer", () => {
	it("handles cancellation in every state, retained context, busy input and stale callbacks", () => {
		const empty = emptySession(sessionId);
		const ongoing = reduceSession(empty, { type: "accept", sessionId, turnId });
		const processing = reduceSession(ongoing, {
			type: "dispatch",
			sessionId,
			turnId,
		});
		const idle = reduceSession(processing, {
			type: "finish",
			sessionId,
			turnId,
			outcome: "completed",
		});
		for (const state of [empty, ongoing, processing, idle]) {
			const result = reduceSession(state, {
				type: "finish",
				sessionId,
				turnId,
				outcome: "cancelled",
			});
			expect(result.state).toBe(state.hasCompletedExchange ? "IDLE" : "EMPTY");
			expect(Option.isNone(result.activeTurn)).toBe(true);
			expect(
				reduceSession(state, {
					type: "finish",
					sessionId: otherSession,
					turnId,
					outcome: "cancelled",
				}),
			).toBe(state);
			expect(
				reduceSession(state, {
					type: "finish",
					sessionId,
					turnId: otherTurn,
					outcome: "cancelled",
				}),
			).toBe(state);
		}
		expect(
			reduceSession(processing, {
				type: "accept",
				sessionId,
				turnId: otherTurn,
			}),
		).toBe(processing);
		for (const outcome of ["cancelled", "failed", "timedOut"] as const) {
			const next = reduceSession(idle, {
				type: "accept",
				sessionId,
				turnId: otherTurn,
			});
			expect(
				reduceSession(next, {
					type: "finish",
					sessionId,
					turnId: otherTurn,
					outcome,
				}).state,
			).toBe("IDLE");
		}
		const closed = reduceSession(processing, { type: "close", sessionId });
		expect(closed).toEqual(empty);
		expect(
			reduceSession(closed, {
				type: "finish",
				sessionId,
				turnId,
				outcome: "completed",
			}),
		).toBe(closed);
	});
});
